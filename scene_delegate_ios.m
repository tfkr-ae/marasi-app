//go:build ios

// Wails v3's iOS shell (WailsAppDelegate) creates its UIWindow with
// initWithFrame: and never adopts the UIScene lifecycle. Apps linked against
// the iOS 27 SDK must adopt it: UIKit traps at the first scene
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption) otherwise.
// build/ios/Info.plist and Info.dev.plist name this class in
// UIApplicationSceneManifest; it moves the delegate's window onto the scene.
// Remove it once Wails adopts scenes itself.

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

// Wails insets its web view by the safe area, which leaves the window's
// background showing as bars (the iPhone Duo's side status column, the home
// indicator). Marasi draws edge to edge instead: the web view fills the view,
// and the frontend pads itself with env(safe-area-inset-*) (viewport-fit=cover
// in app.html). Wails' native tab bar, which Marasi doesn't use, keeps the
// stock layout.
//
// The page itself never scrolls (its panes do), so the web view's own
// scroller doesn't bounce: a sideways drag moved the whole screen.
static void (*wailsLayoutSubviews)(UIViewController *, SEL);

static void marasiLayoutSubviews(UIViewController *self, SEL _cmd) {
    wailsLayoutSubviews(self, _cmd);
    UIView *webView = [self valueForKey:@"webView"];
    UIView *tabBar = [self valueForKey:@"tabBar"];
    if (webView != nil && (tabBar == nil || tabBar.isHidden)) {
        webView.frame = self.view.bounds;
    }
    UIScrollView *scroll = nil;
    @try {
        scroll = [webView valueForKey:@"scrollView"];
    } @catch (NSException *e) {
        scroll = nil;
    }
    if ([scroll isKindOfClass:UIScrollView.class]) {
        scroll.bounces = NO;
        scroll.alwaysBounceHorizontal = NO;
        scroll.alwaysBounceVertical = NO;
    }
}

static void fillWebViewEdgeToEdge(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Class cls = NSClassFromString(@"WailsViewController");
        Method method = cls ? class_getInstanceMethod(cls, @selector(viewDidLayoutSubviews)) : NULL;
        if (method == NULL) {
            return;
        }
        wailsLayoutSubviews = (void (*)(UIViewController *, SEL))method_setImplementation(
            method, (IMP)marasiLayoutSubviews);
    });
}

@interface MarasiSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (strong, nonatomic) UIWindow *window;
@end

@implementation MarasiSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
        return;
    }
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    fillWebViewEdgeToEdge();
    id<UIApplicationDelegate> appDelegate = [UIApplication sharedApplication].delegate;

    // didFinishLaunchingWithOptions runs before the scene connects, so the
    // Wails window (sized from UIScreen.mainScreen, which doesn't follow the
    // scene) normally exists by now. Replace it with a window the scene owns,
    // so it tracks the scene's size (an iPhone Duo fold resizes the scene),
    // and carry its root view controller and colour over. Wails looks up
    // appDelegate.window each time it needs it, so the swap is safe.
    UIWindow *old = [appDelegate respondsToSelector:@selector(window)] ? appDelegate.window : nil;
    UIWindow *window = [[UIWindow alloc] initWithWindowScene:windowScene];
    if (old != nil) {
        window.backgroundColor = old.backgroundColor;
        UIViewController *root = old.rootViewController;
        old.rootViewController = nil;
        old.hidden = YES;
        window.rootViewController = root;
    }
    if ([appDelegate respondsToSelector:@selector(setWindow:)]) {
        appDelegate.window = window;
    }
    self.window = window;
    [window makeKeyAndVisible];
}

- (void)windowScene:(UIWindowScene *)windowScene
    didUpdateCoordinateSpace:(id<UICoordinateSpace>)previousCoordinateSpace
        interfaceOrientation:(UIInterfaceOrientation)previousInterfaceOrientation
             traitCollection:(UITraitCollection *)previousTraitCollection {
    self.window.frame = windowScene.coordinateSpace.bounds;
}

@end
