export const MARASI_API = {
    marasi: {
        type: "namespace",
        details: "The global library exposing proxy functionality and sub-libraries.",
        children: {
            log: {
                type: "method",
                args: '("${1:message}", "${2:INFO}") -- INFO | WARN | ERROR',
                argLabel: "(str, str)",
                returnType: "void",
                details: "Writes a message to the proxy's log."
            },
            config: {
                type: "method",
                args: "()",
                argLabel: "()",
                returnType: "string",
                details: "Returns the path to the proxy's configuration directory."
            },
            scope: {
                type: "method",
                args: "()",
                argLabel: "()",
                returnType: "compass.Scope",
                details: "Returns the proxy's current scope object."
            },
            builder: {
                type: "method",
                args: "(${1:request})",
                argLabel: "(Request | nil)",
                returnType: "RequestBuilder",
                details: "Creates a new request builder, optionally using an existing request as a template."
            },

            settings: {
                type: "namespace",
                details: "Functions for managing persistent extension settings.",
                children: {
                    get: {
                        type: "method",
                        args: "()",
                        argLabel: "()",
                        returnType: "table",
                        details: "Returns the settings for the current extension."
                    },
                    set: {
                        type: "method",
                        args: "(${1:settings_table})",
                        argLabel: "(table)",
                        returnType: "void",
                        details: "Updates the settings for the current extension."
                    },
                },
            },
            repo: {
                type: "namespace",
                details: "Provides access to the traffic repository for querying request/response data.",
                children: {
                    get_summary: {
                        type: "method",
                        args: "()",
                        argLabel: "()",
                        returnType: "[]repo.Summary",
                        details: "Retrieves a summary of all request/response pairs in the repository."
                    },
                    get_details: {
                        type: "method",
                        args: '("${1:uuid}")',
                        argLabel: "(str)",
                        returnType: "repo.Details",
                        details: "Retrieves full details for a specific request/response pair."
                    },
                    get_metadata: {
                        type: "method",
                        args: '("${1:uuid}")',
                        argLabel: "(str)",
                        returnType: "table",
                        details: "Retrieves the metadata associated with a specific request/response pair."
                    },
                    set_metadata: {
                        type: "method",
                        args: '("${1:uuid}", ${2:metadata_table})',
                        argLabel: "(str, table)",
                        returnType: "void",
                        details: "Updates the metadata for a specific request/response pair."
                    },
                    get_note: {
                        type: "method",
                        args: '("${1:uuid}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Retrieves the note associated with a specific request/response pair."
                    },
                    set_note: {
                        type: "method",
                        args: '("${1:uuid}", "${2:note}")',
                        argLabel: "(str, str)",
                        returnType: "void",
                        details: "Updates the note for a specific request/response pair."
                    },
                    search_by_metadata: {
                        type: "method",
                        args: '("${1:path}", ${2:value})',
                        argLabel: "(str, any)",
                        returnType: "[]repo.Summary",
                        details: "Retrieves requests where the value at the specified JSON path matches the provided value."
                    },
                },
            },
            utils: {
                type: "namespace",
                details: "General utility functions.",
                children: {
                    uuid: {
                        type: "method",
                        args: "()",
                        argLabel: "()",
                        returnType: "string",
                        details: "Generates a new UUIDv7 and returns it as a string."
                    },
                    timestamp: {
                        type: "method",
                        args: "()",
                        argLabel: "()",
                        returnType: "number",
                        details: "Returns the current time as a Unix timestamp in milliseconds."
                    },
                    sleep: {
                        type: "method",
                        args: "(${1:ms})",
                        argLabel: "(int)",
                        returnType: "void",
                        details: "Pauses the execution for a given number of milliseconds."
                    },
                    cookie: {
                        type: "method",
                        args: '("${1:name}", "${2:value}")',
                        argLabel: "(str, str)",
                        returnType: "http.Cookie",
                        details: "Creates a new cookie object."
                    },
                    url: {
                        type: "method",
                        args: '("${1:url_string}")',
                        argLabel: "(str)",
                        returnType: "url.URL",
                        details: "Creates a new URL object from a string."
                    },
                },
            },
            strings: {
                type: "namespace",
                details: "String manipulation functions.",
                children: {
                    upper: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Converts a string to uppercase."
                    },
                    lower: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Converts a string to lowercase."
                    },
                    reverse: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Reverses a string."
                    },
                    len: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "number",
                        details: "Returns the length of a string."
                    },
                    replace: {
                        type: "method",
                        args: '("${1:str}", "${2:target}", "${3:replacement}")',
                        argLabel: "(str, str, str)",
                        returnType: "string",
                        details: "Replaces all occurrences of a substring with another string."
                    },
                    contains: {
                        type: "method",
                        args: '("${1:str}", "${2:substr}")',
                        argLabel: "(str, str)",
                        returnType: "boolean",
                        details: "Checks if a string contains a substring."
                    },
                    has_prefix: {
                        type: "method",
                        args: '("${1:str}", "${2:prefix}")',
                        argLabel: "(str, str)",
                        returnType: "boolean",
                        details: "Checks if a string starts with a prefix."
                    },
                    has_suffix: {
                        type: "method",
                        args: '("${1:str}", "${2:suffix}")',
                        argLabel: "(str, str)",
                        returnType: "boolean",
                        details: "Checks if a string ends with a suffix."
                    },
                    split: {
                        type: "method",
                        args: '("${1:str}", "${2:separator}")',
                        argLabel: "(str, str)",
                        returnType: "table",
                        details: "Splits a string by a separator."
                    },
                    trim: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Removes leading and trailing whitespace from a string."
                    },
                    substring: {
                        type: "method",
                        args: '("${1:str}", ${2:start}, ${3:end})',
                        argLabel: "(str, int, int)",
                        returnType: "string",
                        details: "Returns a substring of a string (0-based start, exclusive end)."
                    },
                },
            },
            random: {
                type: "namespace",
                details: "Random data generation functions.",
                children: {
                    int: {
                        type: "method",
                        args: "(${1:min}, ${2:max})",
                        argLabel: "(int, int)",
                        returnType: "number",
                        details: "Returns a random integer in a given range."
                    },
                    string: {
                        type: "method",
                        args: "(${1:length})",
                        argLabel: "(int)",
                        returnType: "string",
                        details: "Returns a random string of a given length, using an optional charset."
                    },
                },
            },
            gui: {
                type: "namespace",
                details: "Functions for interacting with the frontend GUI.",
                children: {
                    render: {
                        type: "method",
                        args: '("${1:target}", \n\t${2:schema}\n)',
                        argLabel: "(str, table)",
                        returnType: "void",
                        details: "Emits a render event to the frontend with the target and schema."
                    },
                    update: {
                        type: "method",
                        args: '("${1:key}", ${2:value})',
                        argLabel: "(str, any)",
                        returnType: "void",
                        details: "Emits a state update event to the frontend."
                    },
                },
            },
            encoding: {
                type: "namespace",
                details: "Encoding and decoding utilities.",
                children: {
                    base64: {
                        type: "namespace",
                        details: "Base64 encoding and decoding.",
                        children: {
                            encode: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Encodes a string using base64."
                            },
                            decode: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Decodes a base64 encoded string."
                            },
                        },
                    },
                    hex: {
                        type: "namespace",
                        details: "Hexadecimal encoding and decoding.",
                        children: {
                            encode: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Encodes a string using hexadecimal."
                            },
                            decode: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Decodes a hexadecimal encoded string."
                            },
                        },
                    },
                    url: {
                        type: "namespace",
                        details: "URL encoding and decoding.",
                        children: {
                            encode: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Encodes a string for use in a URL query."
                            },
                            decode: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Decodes a URL encoded string."
                            },
                        },
                    },
                    html: {
                        type: "namespace",
                        details: "HTML escaping and unescaping.",
                        children: {
                            escape: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Escapes a string for use in HTML."
                            },
                            unescape: {
                                type: "method",
                                args: '("${1:str}")',
                                argLabel: "(str)",
                                returnType: "string",
                                details: "Unescapes an HTML escaped string."
                            },
                        },
                    },
                    json: {
                        type: "namespace",
                        details: "JSON encoding and decoding.",
                        children: {
                            encode: {
                                type: "method",
                                args: "(${1:val})",
                                argLabel: "(any)",
                                returnType: "string",
                                details: "Encodes a Lua value to a JSON string."
                            },
                            decode: {
                                type: "method",
                                args: '("${1:json_str}")',
                                argLabel: "(str)",
                                returnType: "any",
                                details: "Decodes a JSON string to a Lua value."
                            },
                        },
                    },
                },
            },
            crypto: {
                type: "namespace",
                details: "Cryptographic hashing and encryption functions.",
                children: {
                    md5: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Calculates the MD5 hash of a given string."
                    },
                    sha1: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Calculates the SHA1 hash of a given string."
                    },
                    sha256: {
                        type: "method",
                        args: '("${1:str}")',
                        argLabel: "(str)",
                        returnType: "string",
                        details: "Calculates the SHA256 hash of a given string."
                    },
                    hmac_sha256: {
                        type: "method",
                        args: '("${1:secret}", "${2:msg}")',
                        argLabel: "(str, str)",
                        returnType: "string",
                        details: "Calculates the HMAC-SHA256 of a message with a given secret."
                    },
                    aes: {
                        type: "namespace",
                        details: "AES encryption and decryption utilities.",
                        children: {
                            generate_key: {
                                type: "method",
                                args: "(${1:32})",
                                argLabel: "(int)",
                                returnType: "string",
                                details: "Generates a new AES key of a specified length (16, 24, or 32 bytes)."
                            },
                            gcm: {
                                type: "namespace",
                                details: "AES-GCM (Galois/Counter Mode) operations.",
                                children: {
                                    generate_iv: {
                                        type: "method",
                                        args: "()",
                                        argLabel: "()",
                                        returnType: "string",
                                        details: "Generates a 12-byte initialization vector suitable for AES-GCM."
                                    },
                                    encrypt: {
                                        type: "method",
                                        args: '("${1:key}", "${2:plain}", "${3:iv}")',
                                        argLabel: "(str, str, str)",
                                        returnType: "string",
                                        details: "Encrypts plaintext using AES-GCM."
                                    },
                                    decrypt: {
                                        type: "method",
                                        args: '("${1:key}", "${2:cipher}", "${3:iv}")',
                                        argLabel: "(str, str, str)",
                                        returnType: "string",
                                        details: "Decrypts ciphertext using AES-GCM."
                                    },
                                },
                            },
                            cbc: {
                                type: "namespace",
                                details: "AES-CBC (Cipher Block Chaining) operations.",
                                children: {
                                    generate_iv: {
                                        type: "method",
                                        args: "()",
                                        argLabel: "()",
                                        returnType: "string",
                                        details: "Generates a 16-byte initialization vector suitable for AES-CBC."
                                    },
                                    encrypt: {
                                        type: "method",
                                        args: '("${1:key}", "${2:plain}", "${3:iv}")',
                                        argLabel: "(str, str, str)",
                                        returnType: "string",
                                        details: "Encrypts plaintext using AES-CBC with PKCS7 padding."
                                    },
                                    decrypt: {
                                        type: "method",
                                        args: '("${1:key}", "${2:cipher}", "${3:iv}")',
                                        argLabel: "(str, str, str)",
                                        returnType: "string",
                                        details: "Decrypts ciphertext using AES-CBC and removes PKCS7 padding."
                                    },
                                },
                            },
                        },
                    },
                    rsa: {
                        type: "namespace",
                        details: "RSA encryption and decryption operations.",
                        children: {
                            generate_pair: {
                                type: "method",
                                args: "(${1:2048})",
                                argLabel: "(int)",
                                returnType: "string, string",
                                details: "Generates a new RSA private/public key pair."
                            },
                            encrypt: {
                                type: "method",
                                args: '("${1:pub_key}", "${2:plain}")',
                                argLabel: "(str, str)",
                                returnType: "string",
                                details: "Encrypts plaintext using RSA with OAEP padding and SHA-256."
                            },
                            decrypt: {
                                type: "method",
                                args: '("${1:priv_key}", "${2:cipher}")',
                                argLabel: "(str, str)",
                                returnType: "string",
                                details: "Decrypts ciphertext using RSA with OAEP padding and SHA-256."
                            },
                        },
                    },
                    ed25519: {
                        type: "namespace",
                        details: "Ed25519 signing and verification operations.",
                        children: {
                            generate_pair: {
                                type: "method",
                                args: "()",
                                argLabel: "()",
                                returnType: "string, string",
                                details: "Generates a new Ed25519 private/public key pair."
                            },
                            sign: {
                                type: "method",
                                args: '("${1:priv_key}", "${2:msg}")',
                                argLabel: "(str, str)",
                                returnType: "string",
                                details: "Calculates the signature of a message using a private key."
                            },
                            verify: {
                                type: "method",
                                args: '("${1:pub_key}", "${2:msg}", "${3:sig}")',
                                argLabel: "(str, str, str)",
                                returnType: "boolean",
                                details: "Checks if a signature is valid for a given message and public key."
                            },
                        },
                    },
                },
            },
        },
    },
};

export const TYPE_DEFINITIONS = {
    "http.Request": {
        methods: {
            id: { args: "()", argLabel: "()", returnType: "string", details: "Returns the unique identifier for the request." },
            method: { args: "()", argLabel: "()", returnType: "string", details: "Returns the HTTP method (e.g., GET, POST)." },
            url: { args: "()", argLabel: "()", returnType: "url.URL", details: "Returns the URL object associated with the request." },
            path: { args: "()", argLabel: "()", returnType: "string", details: "Returns the path component of the request URL." },
            host: { args: "()", argLabel: "()", returnType: "string", details: "Returns the host header or URL host." },
            set_host: { args: '("${1:host}")', argLabel: "(str)", returnType: "void", details: "Sets the host for the request." },
            scheme: { args: "()", argLabel: "()", returnType: "string", details: "Returns the protocol scheme (http or https)." },
            proto: { args: "()", argLabel: "()", returnType: "string", details: "Returns the protocol version (e.g., HTTP/1.1)." },
            remote_addr: { args: "()", argLabel: "()", returnType: "string", details: "Returns the IP address of the client that sent the request." },
            body: { args: "()", argLabel: "()", returnType: "string", details: "Returns the request body as a string." },
            set_body: { args: '("${1:body}")', argLabel: "(str)", returnType: "void", details: "Replaces the request body with the given string." },
            headers: { args: "()", argLabel: "()", returnType: "http.Header", details: "Returns the request headers object." },
            content_type: { args: "()", argLabel: "()", returnType: "string", details: "Returns the value of the Content-Type header." },
            cookie: { args: '("${1:name}")', argLabel: "(str)", returnType: "http.Cookie", details: "Returns a cookie object by name if it exists." },
            set_cookie: { args: "(${1:cookie_obj})", argLabel: "(Cookie)", returnType: "void", details: "Adds or updates a cookie in the request." },
            cookies: { args: "()", argLabel: "()", returnType: "[]http.Cookie", details: "Returns a table containing all cookies in the request." },
            set_cookies: { args: "(${1:cookies_table})", argLabel: "(table)", returnType: "void", details: "Replaces all cookies in the request with the provided table." },
            metadata: { args: "()", argLabel: "()", returnType: "table", details: "Returns the extension-specific metadata for this request." },
            set_metadata: { args: "(${1:meta_table})", argLabel: "(table)", returnType: "void", details: "Sets the extension-specific metadata for this request." },
            drop: { args: "()", argLabel: "()", returnType: "void", details: "Marks the request to be dropped; it will not be forwarded." },
            skip: { args: "()", argLabel: "()", returnType: "void", details: "Marks the request to be skipped by subsequent extensions." },
        },
    },

    "http.Response": {
        methods: {
            id: { args: "()", argLabel: "()", returnType: "string", details: "Returns the unique identifier of the associated request." },
            method: { args: "()", argLabel: "()", returnType: "string", details: "Returns the HTTP method of the associated request." },
            url: { args: "()", argLabel: "()", returnType: "url.URL", details: "Returns the URL of the associated request." },
            status: { args: "()", argLabel: "()", returnType: "string", details: "Returns the HTTP status line (e.g., '200 OK')." },
            status_code: { args: "()", argLabel: "()", returnType: "number", details: "Returns the numeric HTTP status code." },
            set_status_code: { args: "(${1:code})", argLabel: "(int)", returnType: "void", details: "Sets the HTTP status code for the response." },
            length: { args: "()", argLabel: "()", returnType: "number", details: "Returns the content length of the response body." },
            body: { args: "()", argLabel: "()", returnType: "string", details: "Returns the response body as a string." },
            set_body: { args: '("${1:body}")', argLabel: "(str)", returnType: "void", details: "Replaces the response body with the given string." },
            headers: { args: "()", argLabel: "()", returnType: "http.Header", details: "Returns the response headers object." },
            content_type: { args: "()", argLabel: "()", returnType: "string", details: "Returns the value of the Content-Type header." },
            cookie: { args: '("${1:name}")', argLabel: "(str)", returnType: "http.Cookie", details: "Returns a cookie object by name from the response." },
            set_cookie: { args: "(${1:cookie_obj})", argLabel: "(Cookie)", returnType: "void", details: "Adds or updates a cookie in the response." },
            cookies: { args: "()", argLabel: "()", returnType: "[]http.Cookie", details: "Returns a table containing all cookies in the response." },
            set_cookies: { args: "(${1:cookies_table})", argLabel: "(table)", returnType: "void", details: "Replaces all cookies in the response with the provided table." },
            metadata: { args: "()", argLabel: "()", returnType: "table", details: "Returns the extension-specific metadata for this response." },
            set_metadata: { args: "(${1:meta_table})", argLabel: "(table)", returnType: "void", details: "Sets the extension-specific metadata for this response." },
            drop: { args: "()", argLabel: "()", returnType: "void", details: "Marks the response to be dropped; it will not be returned to the client." },
            skip: { args: "()", argLabel: "()", returnType: "void", details: "Marks the response to be skipped by subsequent extensions." },
        },
    },

    "url.URL": {
        methods: {
            string: { args: "()", argLabel: "()", returnType: "string", details: "Returns the full URL as a string." },
            scheme: { args: "()", argLabel: "()", returnType: "string", details: "Returns the scheme (e.g., http, https)." },
            set_scheme: { args: '("${1:scheme}")', argLabel: "(str)", returnType: "void", details: "Sets the scheme of the URL." },
            host: { args: "()", argLabel: "()", returnType: "string", details: "Returns the host (e.g., example.com:8080)." },
            set_host: { args: '("${1:host}")', argLabel: "(str)", returnType: "void", details: "Sets the host of the URL." },
            path: { args: "()", argLabel: "()", returnType: "string", details: "Returns the path component." },
            set_path: { args: '("${1:path}")', argLabel: "(str)", returnType: "void", details: "Sets the path component." },
            query: { args: "()", argLabel: "()", returnType: "string", details: "Returns the raw query string." },
            set_query: { args: '("${1:query}")', argLabel: "(str)", returnType: "void", details: "Sets the raw query string." },
            get_param: { args: '("${1:key}")', argLabel: "(str)", returnType: "string", details: "Returns the first value of a specific query parameter." },
            set_param: { args: '("${1:key}", "${2:val}")', argLabel: "(str, str)", returnType: "void", details: "Sets a query parameter to a specific value." },
            del_param: { args: '("${1:key}")', argLabel: "(str)", returnType: "void", details: "Removes a query parameter." },
        },
    },

    "http.Header": {
        methods: {
            get: { args: '("${1:key}")', argLabel: "(str)", returnType: "string", details: "Returns the first value associated with the given key." },
            values: { args: '("${1:key}")', argLabel: "(str)", returnType: "table", details: "Returns all values associated with the given key as a table." },
            to_table: { args: "()", argLabel: "()", returnType: "table", details: "Returns the entire header map as a Lua table." },
            set: { args: '("${1:key}", "${2:val}")', argLabel: "(str, str)", returnType: "void", details: "Sets the header entries associated with key to the single element value." },
            add: { args: '("${1:key}", "${2:val}")', argLabel: "(str, str)", returnType: "void", details: "Adds the key, value pair to the header." },
            delete: { args: '("${1:key}")', argLabel: "(str)", returnType: "void", details: "Deletes the values associated with the key." },
            has: { args: '("${1:key}")', argLabel: "(str)", returnType: "boolean", details: "Checks if the header contains the given key." },
        },
    },

    "http.Cookie": {
        methods: {
            name: { args: "()", argLabel: "()", returnType: "string", details: "Returns the name of the cookie." },
            set_name: { args: '("${1:name}")', argLabel: "(str)", returnType: "void", details: "Sets the name of the cookie." },
            value: { args: "()", argLabel: "()", returnType: "string", details: "Returns the value of the cookie." },
            set_value: { args: '("${1:val}")', argLabel: "(str)", returnType: "void", details: "Sets the value of the cookie." },
            domain: { args: "()", argLabel: "()", returnType: "string", details: "Returns the domain of the cookie." },
            set_domain: { args: '("${1:domain}")', argLabel: "(str)", returnType: "void", details: "Sets the domain of the cookie." },
            path: { args: "()", argLabel: "()", returnType: "string", details: "Returns the path of the cookie." },
            set_path: { args: '("${1:path}")', argLabel: "(str)", returnType: "void", details: "Sets the path of the cookie." },
            expires: { args: "()", argLabel: "()", returnType: "number", details: "Returns the expiration timestamp of the cookie." },
            set_expires: { args: "(${1:timestamp})", argLabel: "(int)", returnType: "void", details: "Sets the expiration timestamp of the cookie." },
            serialize: { args: "()", argLabel: "()", returnType: "string", details: "Returns the string representation of the cookie for use in headers." },
            secure: { args: "()", argLabel: "()", returnType: "boolean", details: "Returns true if the cookie is secure." },
            http_only: { args: "()", argLabel: "()", returnType: "boolean", details: "Returns true if the cookie is HTTP only." },
        },
    },

    "RequestBuilder": {
        methods: {
            method: { args: "()", argLabel: "()", returnType: "string", details: "Returns the method currently set on the builder." },
            set_method: { args: '("${1:GET}")', argLabel: "(str)", returnType: "RequestBuilder", details: "Sets the HTTP method for the request." },
            url: { args: "()", argLabel: "()", returnType: "url.URL", details: "Returns the URL currently set on the builder." },
            set_url: { args: '("${1:url}")', argLabel: "(str)", returnType: "RequestBuilder", details: "Sets the URL for the request." },
            body: { args: "()", argLabel: "()", returnType: "string", details: "Returns the body currently set on the builder." },
            set_body: { args: '("${1:body}")', argLabel: "(str)", returnType: "RequestBuilder", details: "Sets the body for the request." },
            headers: { args: "()", argLabel: "()", returnType: "http.Header", details: "Returns the headers currently set on the builder." },
            set_headers: { args: "(${1:header_obj})", argLabel: "(Header)", returnType: "RequestBuilder", details: "Sets the headers for the request using a header object." },
            add_header: { args: '("${1:key}", "${2:val}")', argLabel: "(str, str)", returnType: "RequestBuilder", details: "Adds a header key-value pair to the request." },
            cookies: { args: "()", argLabel: "()", returnType: "[]http.Cookie", details: "Returns the list of cookies currently set on the builder." },
            set_cookie: { args: "(${1:cookie_obj})", argLabel: "(Cookie)", returnType: "RequestBuilder", details: "Adds a cookie to the request." },
            set_cookies: { args: "(${1:cookies_table})", argLabel: "(table)", returnType: "RequestBuilder", details: "Replaces all cookies in the request." },
            metadata: { args: "()", argLabel: "()", returnType: "table", details: "Returns the metadata currently set on the builder." },
            set_metadata: { args: "(${1:table})", argLabel: "(table)", returnType: "RequestBuilder", details: "Sets the metadata for the request." },
            send: { args: "()", argLabel: "()", returnType: "http.Response", details: "Sends the request synchronously and returns the response." },
            send_async: { args: "(function(cb_res)\n\t${}\nend)", argLabel: "(func)", returnType: "void", details: "Sends the request asynchronously; the callback receives (response, error)." },
        }
    },

    "compass.Scope": {
        methods: {
            add_rule: { args: '("${1:rule}", "${2:type}")', argLabel: "(str, str)", returnType: "void", details: "Adds a rule to the scope." },
            remove_rule: { args: '("${1:rule}", "${2:type}")', argLabel: "(str, str)", returnType: "void", details: "Removes a rule from the scope." },
            matches: { args: "(${1:req_or_res})", argLabel: "(Request)", returnType: "boolean", details: "Checks if the scope matches the given request or response object." },
            set_default_allow: { args: "(${1:bool})", argLabel: "(bool)", returnType: "void", details: "Sets the default behavior (allow/deny) when no rules match." },
            matches_string: { args: '("${1:input}", "${2:type}")', argLabel: "(str, str)", returnType: "boolean", details: "Checks if a string matches the scope rules for a specific type." },
            clear_rules: { args: "()", argLabel: "()", returnType: "void", details: "Clears all rules from the scope." }
        }
    },

    "regexp.Regexp": {
        methods: {
            match: { args: '("${1:str}")', argLabel: "(str)", returnType: "boolean", details: "Checks if the pattern matches the string." },
            is_anchored_match: { args: '("${1:str}")', argLabel: "(str)", returnType: "boolean", details: "Checks if the pattern matches the string, anchored at the beginning." },
            find_submatch_indices: { args: '("${1:str}")', argLabel: "(str)", returnType: "table", details: "Returns a table of indices identifying the leftmost match and its submatches." },
            find_named_submatch: { args: '("${1:str}")', argLabel: "(str)", returnType: "table", details: "Returns a table of named submatches." },
            find_all: { args: '("${1:str}")', argLabel: "(str)", returnType: "table", details: "Returns all successive matches of the pattern." },
            replace: { args: '("${1:str}", "${2:replacement}")', argLabel: "(str, str)", returnType: "string", details: "Replaces matches in the string with the replacement string." },
            split: { args: '("${1:str}")', argLabel: "(str)", returnType: "table", details: "Splits the string into substrings separated by the pattern." },
            pattern: { args: "()", argLabel: "()", returnType: "string", details: "Returns the regular expression pattern string." },
            find: { args: '("${1:str}")', argLabel: "(str)", returnType: "string", details: "Returns the leftmost match of the pattern in the string." }
        }
    },

    "repo.Summary": {
        properties: {
            id: { type: "string", details: "The UUID of the request." },
            scheme: { type: "string", details: "The request scheme (http/https)." },
            method: { type: "string", details: "The HTTP method (GET, POST, etc)." },
            host: { type: "string", details: "The target host." },
            path: { type: "string", details: "The request path." },
            status: { type: "string", details: "The status string (e.g. '200 OK')." },
            status_code: { type: "number", details: "The numeric status code." },
            content_type: { type: "string", details: "The response content type." },
            length: { type: "string", details: "The content length." },
            metadata: { type: "table", details: "The metadata table." },
            requested_at: { type: "number", details: "Timestamp of the request." },
            responded_at: { type: "number", details: "Timestamp of the response." },
        }
    },

    "repo.Details": {
        properties: {
            request: { type: "repo.RequestData", details: "The detailed request object." },
            response: { type: "repo.ResponseData", details: "The detailed response object." },
            metadata: { type: "table", details: "Metadata associated with the pair." },
            note: { type: "string", details: "User notes associated with the pair." }
        }
    },

    "repo.RequestData": {
        properties: {
            id: { type: "string", details: "The UUID of the request." },
            scheme: { type: "string", details: "The request scheme." },
            method: { type: "string", details: "The HTTP method." },
            host: { type: "string", details: "The host header." },
            path: { type: "string", details: "The URL path." },
            raw: { type: "string", details: "The raw request body." },
            metadata: { type: "table", details: "Request-specific metadata." },
            requested_at: { type: "number", details: "Timestamp of the request." }
        }
    },

    "repo.ResponseData": {
        properties: {
            id: { type: "string", details: "The UUID of the response." },
            status: { type: "string", details: "The status line." },
            status_code: { type: "number", details: "The status code." },
            content_type: { type: "string", details: "The content type header." },
            length: { type: "string", details: "The content length." },
            raw: { type: "string", details: "The raw response body." },
            metadata: { type: "table", details: "Response-specific metadata." },
            responded_at: { type: "number", details: "Timestamp of the response." }
        }
    }
};
