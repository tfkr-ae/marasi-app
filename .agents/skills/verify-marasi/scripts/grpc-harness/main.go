// chatharness: a gRPC + streaming test origin and a client that reaches it
// through the Marasi proxy, for verifying marasi-app's streamed-pair UI.
//
//	chatharness server [-grpc-port 50051] [-http-port 50052] [-fail-after 0]
//	chatharness <mode> -proxy 127.0.0.1:<proxy port> [-addr 127.0.0.1:50051] [-every 2s] [-count 0]
//
// Modes: converse (bidi), subscribe (server stream), unary, web (gRPC-Web),
// connect (Connect server stream), sse, ndjson. See
// ../../features/ledger/streamed-pairs.md.
//
// No protoc: ChatMessage is hand-encoded protobuf (protowire), registered as
// the "proto" codec, so the content type stays application/grpc and Marasi
// shows its protoscope text form.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protowire"
)

// ChatMessage is `message ChatMessage { int64 seq = 1; string sender = 2;
// string text = 3; int64 unix_ms = 4; }`.
type ChatMessage struct {
	Seq    int64
	Sender string
	Text   string
	UnixMs int64
}

func (m *ChatMessage) Marshal() []byte {
	var b []byte
	b = protowire.AppendTag(b, 1, protowire.VarintType)
	b = protowire.AppendVarint(b, uint64(m.Seq))
	b = protowire.AppendTag(b, 2, protowire.BytesType)
	b = protowire.AppendString(b, m.Sender)
	b = protowire.AppendTag(b, 3, protowire.BytesType)
	b = protowire.AppendString(b, m.Text)
	b = protowire.AppendTag(b, 4, protowire.VarintType)
	b = protowire.AppendVarint(b, uint64(m.UnixMs))
	return b
}

func (m *ChatMessage) Unmarshal(b []byte) error {
	*m = ChatMessage{}
	for len(b) > 0 {
		num, typ, n := protowire.ConsumeTag(b)
		if n < 0 {
			return protowire.ParseError(n)
		}
		b = b[n:]
		switch {
		case num == 1 && typ == protowire.VarintType:
			v, n := protowire.ConsumeVarint(b)
			if n < 0 {
				return protowire.ParseError(n)
			}
			m.Seq, b = int64(v), b[n:]
		case num == 4 && typ == protowire.VarintType:
			v, n := protowire.ConsumeVarint(b)
			if n < 0 {
				return protowire.ParseError(n)
			}
			m.UnixMs, b = int64(v), b[n:]
		case (num == 2 || num == 3) && typ == protowire.BytesType:
			v, n := protowire.ConsumeString(b)
			if n < 0 {
				return protowire.ParseError(n)
			}
			if num == 2 {
				m.Sender = v
			} else {
				m.Text = v
			}
			b = b[n:]
		default: // keep unknown fields readable (an edited or injected message may add some)
			n := protowire.ConsumeFieldValue(num, typ, b)
			if n < 0 {
				return protowire.ParseError(n)
			}
			b = b[n:]
		}
	}
	return nil
}

func (m *ChatMessage) String() string {
	return fmt.Sprintf("#%d %s: %q", m.Seq, m.Sender, m.Text)
}

type codec struct{}

func (codec) Name() string { return "proto" }
func (codec) Marshal(v any) ([]byte, error) {
	m, ok := v.(*ChatMessage)
	if !ok {
		return nil, fmt.Errorf("codec: %T", v)
	}
	return m.Marshal(), nil
}
func (codec) Unmarshal(b []byte, v any) error {
	m, ok := v.(*ChatMessage)
	if !ok {
		return fmt.Errorf("codec: %T", v)
	}
	return m.Unmarshal(b)
}

func init() { encoding.RegisterCodec(codec{}) }

// ---- gRPC service: chat.v1.ChatService ----

const service = "chat.v1.ChatService"

var failAfter int // server: end Converse with FAILED_PRECONDITION after n client messages (0 = never)

func converse(_ any, stream grpc.ServerStream) error {
	md, _ := metadata.FromIncomingContext(stream.Context())
	log.Printf("Converse: open (user-agent %v)", md.Get("user-agent"))
	stream.SendHeader(metadata.Pairs("x-chat-room", "lobby"))
	var n int64
	for {
		in := new(ChatMessage)
		err := stream.RecvMsg(in)
		if errors.Is(err, io.EOF) {
			log.Printf("Converse: client closed after %d messages", n)
			stream.SetTrailer(metadata.Pairs("x-chat-received", fmt.Sprint(n), "x-chat-bye", "see you"))
			return nil
		}
		if err != nil {
			log.Printf("Converse: recv: %v", err)
			return err
		}
		n++
		log.Printf("Converse: <- %s", in)
		out := &ChatMessage{Seq: in.Seq, Sender: "server", Text: "echo: " + in.Text, UnixMs: time.Now().UnixMilli()}
		if err := stream.SendMsg(out); err != nil {
			return err
		}
		if failAfter > 0 && n >= int64(failAfter) {
			stream.SetTrailer(metadata.Pairs("x-chat-received", fmt.Sprint(n)))
			return status.Errorf(codes.FailedPrecondition, "room closed after %d messages", n)
		}
	}
}

func subscribe(_ any, stream grpc.ServerStream) error {
	in := new(ChatMessage)
	if err := stream.RecvMsg(in); err != nil {
		return err
	}
	count := in.Seq // seq doubles as "how many ticks" (0 = until cancelled)
	every := time.Duration(in.UnixMs) * time.Millisecond
	if every <= 0 {
		every = 2 * time.Second
	}
	log.Printf("Subscribe: %d ticks every %s", count, every)
	t := time.NewTicker(every)
	defer t.Stop()
	for i := int64(1); count == 0 || i <= count; i++ {
		if err := stream.SendMsg(&ChatMessage{Seq: i, Sender: "server", Text: "tick", UnixMs: time.Now().UnixMilli()}); err != nil {
			return err
		}
		select {
		case <-stream.Context().Done():
			log.Printf("Subscribe: cancelled")
			return stream.Context().Err()
		case <-t.C:
		}
	}
	stream.SetTrailer(metadata.Pairs("x-chat-ticks", fmt.Sprint(count)))
	return nil
}

func unary(_ any, ctx context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
	in := new(ChatMessage)
	if err := dec(in); err != nil {
		return nil, err
	}
	log.Printf("Say: <- %s", in)
	if strings.HasPrefix(in.Text, "fail") {
		return nil, status.Error(codes.InvalidArgument, "you asked for it")
	}
	grpc.SetTrailer(ctx, metadata.Pairs("x-chat-unary", "ok"))
	return &ChatMessage{Seq: in.Seq, Sender: "server", Text: "said: " + in.Text, UnixMs: time.Now().UnixMilli()}, nil
}

var serviceDesc = grpc.ServiceDesc{
	ServiceName: service,
	HandlerType: (*any)(nil),
	Methods:     []grpc.MethodDesc{{MethodName: "Say", Handler: unary}},
	Streams: []grpc.StreamDesc{
		{StreamName: "Converse", Handler: converse, ServerStreams: true, ClientStreams: true},
		{StreamName: "Subscribe", Handler: subscribe, ServerStreams: true},
	},
}

// ---- HTTP/1.1 endpoints: gRPC-Web, Connect, SSE, NDJSON ----

func envelope(flags byte, payload []byte) []byte {
	b := make([]byte, 5, 5+len(payload))
	b[0] = flags
	binary.BigEndian.PutUint32(b[1:], uint32(len(payload)))
	return append(b, payload...)
}

func ticks(r *http.Request) (int, time.Duration) {
	n, every := 5, 2*time.Second
	fmt.Sscan(r.URL.Query().Get("n"), &n)
	if d, err := time.ParseDuration(r.URL.Query().Get("every")); err == nil {
		every = d
	}
	return n, every
}

// streamTicks writes n ticks, flushing each, and stops early if the client left.
func streamTicks(w http.ResponseWriter, r *http.Request, n int, every time.Duration, write func(i int)) bool {
	f := w.(http.Flusher)
	for i := 1; i <= n; i++ {
		write(i)
		f.Flush()
		if i == n {
			break
		}
		select {
		case <-r.Context().Done():
			log.Printf("%s: client left after %d", r.URL.Path, i)
			return false
		case <-time.After(every):
		}
	}
	return true
}

// readEnvelope reads one enveloped request message (gRPC-Web / Connect).
func readEnvelope(r io.Reader) (*ChatMessage, error) {
	var head [5]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return nil, err
	}
	buf := make([]byte, binary.BigEndian.Uint32(head[1:]))
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	m := new(ChatMessage)
	return m, m.Unmarshal(buf)
}

func httpMux() *http.ServeMux {
	mux := http.NewServeMux()
	// gRPC-Web server stream: POST /chat.v1.ChatService/Subscribe, application/grpc-web+proto.
	mux.HandleFunc("POST /web/chat.v1.ChatService/Subscribe", func(w http.ResponseWriter, r *http.Request) {
		in, err := readEnvelope(r.Body)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		n, every := ticks(r)
		log.Printf("grpc-web Subscribe: %s, %d ticks", in, n)
		w.Header().Set("content-type", "application/grpc-web+proto")
		ok := streamTicks(w, r, n, every, func(i int) {
			w.Write(envelope(0, (&ChatMessage{Seq: int64(i), Sender: "server", Text: "web tick", UnixMs: time.Now().UnixMilli()}).Marshal()))
		})
		if ok { // trailers travel as a 0x80 frame in the body
			w.Write(envelope(0x80, []byte("grpc-status: 0\r\ngrpc-message: \r\nx-chat-ticks: "+fmt.Sprint(n)+"\r\n")))
		}
	})
	// Connect server stream: application/connect+proto; end-of-stream is flag 0x02 with JSON.
	mux.HandleFunc("POST /connect/chat.v1.ChatService/Subscribe", func(w http.ResponseWriter, r *http.Request) {
		in, err := readEnvelope(r.Body)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		n, every := ticks(r)
		log.Printf("connect Subscribe: %s, %d ticks", in, n)
		w.Header().Set("content-type", "application/connect+proto")
		ok := streamTicks(w, r, n, every, func(i int) {
			w.Write(envelope(0, (&ChatMessage{Seq: int64(i), Sender: "server", Text: "connect tick", UnixMs: time.Now().UnixMilli()}).Marshal()))
		})
		if ok {
			w.Write(envelope(0x02, []byte(`{"metadata":{"x-chat-ticks":["`+fmt.Sprint(n)+`"]}}`)))
		}
	})
	mux.HandleFunc("GET /sse", func(w http.ResponseWriter, r *http.Request) {
		n, every := ticks(r)
		w.Header().Set("content-type", "text/event-stream")
		w.Header().Set("cache-control", "no-cache")
		streamTicks(w, r, n, every, func(i int) {
			fmt.Fprintf(w, "id: %d\nevent: tick\ndata: {\"seq\":%d,\"at\":%q}\n\n", i, i, time.Now().Format(time.RFC3339))
		})
	})
	mux.HandleFunc("GET /ndjson", func(w http.ResponseWriter, r *http.Request) {
		n, every := ticks(r)
		w.Header().Set("content-type", "application/x-ndjson")
		streamTicks(w, r, n, every, func(i int) {
			json.NewEncoder(w).Encode(map[string]any{"seq": i, "at": time.Now().Format(time.RFC3339)})
		})
	})
	return mux
}

func runServer(args []string) {
	fs := flag.NewFlagSet("server", flag.ExitOnError)
	grpcPort := fs.Int("grpc-port", 50051, "gRPC (h2c) port")
	httpPort := fs.Int("http-port", 50052, "HTTP/1.1 port: gRPC-Web, Connect, SSE, NDJSON (0 = off)")
	fs.IntVar(&failAfter, "fail-after", 0, "end Converse with FAILED_PRECONDITION after n client messages")
	fs.Parse(args)

	lis, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *grpcPort))
	if err != nil {
		log.Fatal(err)
	}
	s := grpc.NewServer()
	s.RegisterService(&serviceDesc, nil)
	log.Printf("gRPC %s on %s (h2c)", service, lis.Addr())
	if *httpPort != 0 {
		hl, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *httpPort))
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("HTTP/1.1 on %s: /web/..., /connect/..., /sse, /ndjson", hl.Addr())
		go func() { log.Fatal(http.Serve(hl, httpMux())) }()
	}
	log.Fatal(s.Serve(lis))
}

// ---- client ----

// dialThroughProxy opens a CONNECT tunnel through the Marasi proxy. A plain
// h2c gRPC call then runs inside it (Marasi recognises HTTP/2 in the tunnel).
// grpc-go's own proxy support skips loopback targets, hence this dialer.
func dialThroughProxy(proxy string) func(context.Context, string) (net.Conn, error) {
	return func(ctx context.Context, addr string) (net.Conn, error) {
		var d net.Dialer
		c, err := d.DialContext(ctx, "tcp", proxy)
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(c, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", addr, addr)
		br := bufio.NewReader(c)
		resp, err := http.ReadResponse(br, &http.Request{Method: http.MethodConnect})
		if err != nil {
			c.Close()
			return nil, err
		}
		if resp.StatusCode != 200 {
			c.Close()
			return nil, fmt.Errorf("proxy CONNECT: %s", resp.Status)
		}
		if br.Buffered() > 0 {
			c.Close()
			return nil, errors.New("proxy sent bytes after CONNECT")
		}
		return c, nil
	}
}

type clientOpts struct {
	proxy, addr, httpAddr, text string
	every, timeout              time.Duration
	count                       int
}

func runClient(mode string, args []string) {
	fs := flag.NewFlagSet(mode, flag.ExitOnError)
	var o clientOpts
	fs.StringVar(&o.proxy, "proxy", os.Getenv("MARASI_PROXY"), "Marasi proxy host:port (empty = direct)")
	fs.StringVar(&o.addr, "addr", "127.0.0.1:50051", "gRPC origin")
	fs.StringVar(&o.httpAddr, "http-addr", "127.0.0.1:50052", "HTTP/1.1 origin (web, connect, sse, ndjson)")
	fs.StringVar(&o.text, "text", "hello", "message text")
	fs.DurationVar(&o.every, "every", 2*time.Second, "interval between messages")
	fs.IntVar(&o.count, "count", 0, "messages to send, 0 = until Ctrl-C / SIGTERM")
	fs.DurationVar(&o.timeout, "timeout", 0, "call deadline (0 = none); an expired one ends the call with DEADLINE_EXCEEDED")
	fs.Parse(args)
	if o.proxy == "" {
		log.Printf("no -proxy: calling the origin directly")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch mode {
	case "converse", "subscribe", "unary":
		grpcClient(ctx, mode, o)
	case "web", "connect", "sse", "ndjson":
		httpClient(ctx, mode, o)
	default:
		log.Fatalf("unknown mode %q", mode)
	}
}

func grpcClient(stop context.Context, mode string, o clientOpts) {
	opts := []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	if o.proxy != "" {
		opts = append(opts, grpc.WithContextDialer(dialThroughProxy(o.proxy)))
	}
	cc, err := grpc.NewClient("passthrough:///"+o.addr, opts...)
	if err != nil {
		log.Fatal(err)
	}
	defer cc.Close()
	// The call's own context is not the signal one: Ctrl-C first half-closes
	// (CloseSend) so the server answers with trailers; a second Ctrl-C cancels.
	callCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if o.timeout > 0 {
		callCtx, cancel = context.WithTimeout(callCtx, o.timeout)
		defer cancel()
	}
	var header, trailer metadata.MD
	callOpts := []grpc.CallOption{grpc.Header(&header), grpc.Trailer(&trailer)}

	switch mode {
	case "unary":
		out := new(ChatMessage)
		err := cc.Invoke(callCtx, "/"+service+"/Say", &ChatMessage{Seq: 1, Sender: "client", Text: o.text, UnixMs: time.Now().UnixMilli()}, out, callOpts...)
		report(err, header, trailer)
		if err == nil {
			log.Printf("<- %s", out)
		}
	case "subscribe":
		s, err := cc.NewStream(callCtx, &serviceDesc.Streams[1], "/"+service+"/Subscribe", callOpts...)
		if err != nil {
			log.Fatal(err)
		}
		s.SendMsg(&ChatMessage{Seq: int64(o.count), Sender: "client", Text: o.text, UnixMs: o.every.Milliseconds()})
		s.CloseSend()
		go func() {
			select {
			case <-stop.Done():
				log.Printf("stop: cancelling")
				cancel()
			case <-callCtx.Done():
			}
		}()
		for {
			in := new(ChatMessage)
			if err := s.RecvMsg(in); err != nil {
				if errors.Is(err, io.EOF) {
					err = nil
				}
				report(err, header, trailer)
				return
			}
			log.Printf("<- %s", in)
		}
	case "converse":
		s, err := cc.NewStream(callCtx, &serviceDesc.Streams[0], "/"+service+"/Converse", callOpts...)
		if err != nil {
			log.Fatal(err)
		}
		done := make(chan error, 1)
		go func() {
			for {
				in := new(ChatMessage)
				if err := s.RecvMsg(in); err != nil {
					if errors.Is(err, io.EOF) {
						err = nil
					}
					done <- err
					return
				}
				log.Printf("<- %s", in)
			}
		}()
		var mu sync.Mutex
		seq := int64(0)
		send := func(text string) bool {
			mu.Lock()
			defer mu.Unlock()
			seq++
			m := &ChatMessage{Seq: seq, Sender: "client", Text: text, UnixMs: time.Now().UnixMilli()}
			if err := s.SendMsg(m); err != nil {
				log.Printf("send: %v", err)
				return false
			}
			log.Printf("-> %s", m)
			return true
		}
		// Lines typed on stdin are sent at once, besides the timer.
		go func() {
			sc := bufio.NewScanner(os.Stdin)
			for sc.Scan() {
				if t := strings.TrimSpace(sc.Text()); t != "" {
					send(t)
				}
			}
		}()
		t := time.NewTicker(o.every)
		defer t.Stop()
		send(o.text)
	loop:
		for o.count == 0 || seq < int64(o.count) {
			select {
			case <-stop.Done():
				break loop
			case err := <-done:
				report(err, header, trailer)
				return
			case <-t.C:
				if !send(o.text) {
					break loop
				}
			}
		}
		log.Printf("closing send side; waiting for the server's trailers (Ctrl-C again cancels)")
		s.CloseSend()
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		select {
		case err := <-done:
			report(err, header, trailer)
		case <-sig:
			cancel()
			report(<-done, header, trailer)
		}
	}
}

func report(err error, header, trailer metadata.MD) {
	if len(header) > 0 {
		log.Printf("headers: %s", mdString(header))
	}
	st, _ := status.FromError(err)
	log.Printf("end: grpc-status %d (%s) grpc-message %q trailers %s", st.Code(), st.Code(), st.Message(), mdString(trailer))
}

// mdString prints metadata in full (grpc-go's own %v redacts the values).
func mdString(md metadata.MD) string {
	var parts []string
	for k, vs := range md {
		parts = append(parts, k+"="+strings.Join(vs, ","))
	}
	return "{" + strings.Join(parts, " ") + "}"
}

func httpClient(ctx context.Context, mode string, o clientOpts) {
	tr := &http.Transport{ForceAttemptHTTP2: false}
	if o.proxy != "" {
		u, _ := url.Parse("http://" + o.proxy)
		tr.Proxy = http.ProxyURL(u) // ProxyURL, unlike ProxyFromEnvironment, also proxies loopback
	}
	client := &http.Client{Transport: tr}
	n := o.count
	if n == 0 {
		n = 1000000
	}
	q := fmt.Sprintf("?n=%d&every=%s", n, o.every)
	var req *http.Request
	switch mode {
	case "web", "connect":
		ct := map[string]string{"web": "application/grpc-web+proto", "connect": "application/connect+proto"}[mode]
		body := envelope(0, (&ChatMessage{Seq: 1, Sender: "client", Text: o.text}).Marshal())
		req, _ = http.NewRequestWithContext(ctx, "POST", "http://"+o.httpAddr+"/"+mode+"/"+service+"/Subscribe"+q, bytes.NewReader(body))
		req.Header.Set("content-type", ct)
		if mode == "web" {
			req.Header.Set("x-grpc-web", "1")
		}
	case "sse", "ndjson":
		req, _ = http.NewRequestWithContext(ctx, "GET", "http://"+o.httpAddr+"/"+mode+q, nil)
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	log.Printf("%s %s, content-type %s", resp.Proto, resp.Status, resp.Header.Get("content-type"))
	if mode == "sse" || mode == "ndjson" {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if sc.Text() != "" {
				log.Printf("<- %s", sc.Text())
			}
		}
		log.Printf("end: %v", errOrEOF(sc.Err(), ctx))
		return
	}
	for {
		var head [5]byte
		if _, err := io.ReadFull(resp.Body, head[:]); err != nil {
			log.Printf("end: %v", errOrEOF(err, ctx))
			return
		}
		buf := make([]byte, binary.BigEndian.Uint32(head[1:]))
		if _, err := io.ReadFull(resp.Body, buf); err != nil {
			log.Printf("end: %v", err)
			return
		}
		if head[0]&0x82 != 0 { // gRPC-Web trailers (0x80) or Connect end-of-stream (0x02)
			log.Printf("<- end frame (flags 0x%02x): %q", head[0], buf)
			continue
		}
		m := new(ChatMessage)
		m.Unmarshal(buf)
		log.Printf("<- %s", m)
	}
}

func errOrEOF(err error, ctx context.Context) any {
	if ctx.Err() != nil {
		return "stopped"
	}
	if err == nil || errors.Is(err, io.EOF) {
		return "EOF"
	}
	return err
}

func main() {
	log.SetFlags(log.Ltime | log.Lmicroseconds)
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: chatharness server|converse|subscribe|unary|web|connect|sse|ndjson [flags]  (-h per mode)")
		os.Exit(2)
	}
	if os.Args[1] == "server" {
		runServer(os.Args[2:])
		return
	}
	runClient(os.Args[1], os.Args[2:])
}
