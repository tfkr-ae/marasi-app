//go:build ios

// The pairing QR scanner (qr_scan.go). The camera preview is a native view
// over the box the page keeps for it, so it sits inside the Connections
// modal; Vision reads QR codes from the camera's frames, and the first one's
// text goes to Go (marasiQRScanned), which sends it to the page. A failure
// goes to marasiQRFailed as "camera-denied", "no-camera" or "camera-failed".

#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
#include "_cgo_export.h"

@interface MarasiQRScanner : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@property (nonatomic, strong) AVCaptureSession *session;
@property (nonatomic, strong) UIView *preview;
@property (nonatomic, strong) AVCaptureVideoPreviewLayer *previewLayer;
@property (nonatomic, strong) dispatch_queue_t sessionQueue;
@property (nonatomic, strong) dispatch_queue_t frameQueue;
@property (nonatomic, assign) CGRect rect;
// Bumped by every start and stop, so a late frame or permission answer from
// an earlier scan does nothing.
@property (atomic, assign) NSUInteger generation;
@property (atomic, assign) BOOL found;
@property (atomic, assign) CFTimeInterval lastRead;
@end

static MarasiQRScanner *scanner(void) {
    static MarasiQRScanner *shared;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        shared = [MarasiQRScanner new];
        shared.sessionQueue = dispatch_queue_create("marasi.qr.session", DISPATCH_QUEUE_SERIAL);
        shared.frameQueue = dispatch_queue_create("marasi.qr.frames", DISPATCH_QUEUE_SERIAL);
    });
    return shared;
}

static void fail(NSString *reason) {
    marasiQRFailed((char *)reason.UTF8String);
}

// The Wails view controller's view and its web view: the preview goes over
// the web view, in its coordinates.
static UIView *hostView(UIView **webView) {
    UIWindow *window = nil;
    id<UIApplicationDelegate> delegate = [UIApplication sharedApplication].delegate;
    if ([delegate respondsToSelector:@selector(window)]) {
        window = delegate.window;
    }
    UIViewController *root = window.rootViewController;
    if (root == nil) {
        return nil;
    }
    @try {
        *webView = [root valueForKey:@"webView"];
    } @catch (NSException *e) {
        *webView = nil;
    }
    return root.view;
}

static CGFloat rotationAngle(UIView *view) {
    UIInterfaceOrientation orientation = view.window.windowScene.interfaceOrientation;
    switch (orientation) {
        case UIInterfaceOrientationLandscapeLeft: return 180;
        case UIInterfaceOrientationLandscapeRight: return 0;
        case UIInterfaceOrientationPortraitUpsideDown: return 270;
        default: return 90;
    }
}

// The text of the first QR code in a frame, or nil. Vision reads skewed and
// blurry codes best, but can't run where it has no inference context (the
// Simulator); Core Image's detector reads them there.
static NSString *readQRCode(CVPixelBufferRef pixels) {
    VNDetectBarcodesRequest *request = [VNDetectBarcodesRequest new];
    request.symbologies = @[ VNBarcodeSymbologyQR ];
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pixels options:@{}];
    if ([handler performRequests:@[ request ] error:nil]) {
        for (VNBarcodeObservation *code in request.results) {
            if (code.payloadStringValue.length > 0) {
                return code.payloadStringValue;
            }
        }
        return nil;
    }
    static CIDetector *detector;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        detector = [CIDetector detectorOfType:CIDetectorTypeQRCode
                                      context:nil
                                      options:@{CIDetectorAccuracy : CIDetectorAccuracyHigh}];
    });
    CIImage *image = [CIImage imageWithCVPixelBuffer:pixels];
    for (CIFeature *feature in [detector featuresInImage:image]) {
        NSString *text = ((CIQRCodeFeature *)feature).messageString;
        if (text.length > 0) {
            return text;
        }
    }
    return nil;
}

@implementation MarasiQRScanner

// Places the preview over self.rect and turns it with the screen. Main thread.
- (void)layout {
    UIView *webView = nil;
    UIView *host = hostView(&webView);
    if (host == nil || self.preview == nil) {
        return;
    }
    if (self.preview.superview != host) {
        [host addSubview:self.preview];
    }
    [host bringSubviewToFront:self.preview];
    CGRect frame = webView ? [webView convertRect:self.rect toView:host] : self.rect;
    self.preview.frame = frame;
    self.previewLayer.frame = self.preview.bounds;
    AVCaptureConnection *connection = self.previewLayer.connection;
    if (connection == nil) {
        return;
    }
    CGFloat angle = rotationAngle(host);
    if (@available(iOS 17.0, *)) {
        if ([connection isVideoRotationAngleSupported:angle]) {
            connection.videoRotationAngle = angle;
        }
    }
}

- (AVCaptureDevice *)camera {
    AVCaptureDevice *back = [AVCaptureDevice defaultDeviceWithDeviceType:AVCaptureDeviceTypeBuiltInWideAngleCamera
                                                               mediaType:AVMediaTypeVideo
                                                                position:AVCaptureDevicePositionBack];
    return back ?: [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
}

// Opens the camera and shows its preview. Main thread, access granted.
- (void)open:(NSUInteger)generation {
    if (generation != self.generation) {
        return;
    }
    AVCaptureDevice *device = [self camera];
    if (device == nil) {
        fail(@"no-camera");
        return;
    }
    NSError *error = nil;
    AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
    AVCaptureSession *session = [AVCaptureSession new];
    AVCaptureVideoDataOutput *output = [AVCaptureVideoDataOutput new];
    output.alwaysDiscardsLateVideoFrames = YES;
    output.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)};
    [output setSampleBufferDelegate:self queue:self.frameQueue];
    if (input == nil || ![session canAddInput:input] || ![session canAddOutput:output]) {
        fail(@"camera-failed");
        return;
    }
    [session beginConfiguration];
    [session addInput:input];
    [session addOutput:output];
    [session commitConfiguration];

    self.session = session;
    self.found = NO;
    self.preview = [UIView new];
    self.preview.userInteractionEnabled = NO;
    self.preview.clipsToBounds = YES;
    self.preview.backgroundColor = UIColor.blackColor;
    self.previewLayer = [AVCaptureVideoPreviewLayer layerWithSession:session];
    self.previewLayer.videoGravity = AVLayerVideoGravityResizeAspectFill;
    [self.preview.layer addSublayer:self.previewLayer];
    [self layout];
    dispatch_async(self.sessionQueue, ^{
        [session startRunning];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self layout];
        });
    });
}

// Closes the camera and removes the preview. Main thread.
- (void)close {
    self.generation += 1;
    AVCaptureSession *session = self.session;
    self.session = nil;
    [self.preview removeFromSuperview];
    self.preview = nil;
    self.previewLayer = nil;
    if (session != nil) {
        dispatch_async(self.sessionQueue, ^{
            [session stopRunning];
        });
    }
}

- (void)captureOutput:(AVCaptureOutput *)output
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
           fromConnection:(AVCaptureConnection *)connection {
    if (self.found) {
        return;
    }
    CFTimeInterval now = CACurrentMediaTime();
    if (now - self.lastRead < 0.15) {
        return;
    }
    self.lastRead = now;
    CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (pixels == NULL) {
        return;
    }
    NSString *text = readQRCode(pixels);
    if (text.length > 0) {
        self.found = YES;
        NSUInteger generation = self.generation;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (generation != self.generation) {
                return;
            }
            [self close];
            marasiQRScanned((char *)text.UTF8String);
        });
    }
}

@end

void marasiQRStart(double x, double y, double width, double height) {
    CGRect rect = CGRectMake(x, y, width, height);
    dispatch_async(dispatch_get_main_queue(), ^{
        MarasiQRScanner *s = scanner();
        s.rect = rect;
        if (s.session != nil) {
            [s layout];
            return;
        }
        s.generation += 1;
        NSUInteger generation = s.generation;
        switch ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]) {
            case AVAuthorizationStatusAuthorized:
                [s open:generation];
                break;
            case AVAuthorizationStatusNotDetermined: {
                [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
                    dispatch_async(dispatch_get_main_queue(), ^{
                        if (generation != s.generation) {
                            return;
                        }
                        if (granted) {
                            [s open:generation];
                        } else {
                            fail(@"camera-denied");
                        }
                    });
                }];
                break;
            }
            default:
                fail(@"camera-denied");
                break;
        }
    });
}

void marasiQRMove(double x, double y, double width, double height) {
    CGRect rect = CGRectMake(x, y, width, height);
    dispatch_async(dispatch_get_main_queue(), ^{
        MarasiQRScanner *s = scanner();
        s.rect = rect;
        [s layout];
    });
}

void marasiQRStop(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [scanner() close];
    });
}
