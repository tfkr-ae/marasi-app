//go:build ios

// The share sheet for a Save As on iOS (share_file_ios.go).

#import <UIKit/UIKit.h>
#include "_cgo_export.h"

// The view controller on top, which presents the sheet.
static UIViewController *topController(void) {
    UIWindow *window = nil;
    id<UIApplicationDelegate> delegate = [UIApplication sharedApplication].delegate;
    if ([delegate respondsToSelector:@selector(window)]) {
        window = delegate.window;
    }
    UIViewController *top = window.rootViewController;
    while (top.presentedViewController != nil) {
        top = top.presentedViewController;
    }
    return top;
}

void marasiShareFile(unsigned int id, const char *path) {
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
    dispatch_async(dispatch_get_main_queue(), ^{
        UIViewController *top = topController();
        if (top == nil) {
            marasiShareFileDone(id, 0);
            return;
        }
        UIActivityViewController *sheet = [[UIActivityViewController alloc] initWithActivityItems:@[ url ]
                                                                            applicationActivities:nil];
        sheet.completionWithItemsHandler = ^(UIActivityType type, BOOL completed, NSArray *items, NSError *error) {
            marasiShareFileDone(id, completed ? 1 : 0);
        };
        // A popover where the screen is wide enough for one (iPad, the Duo
        // unfolded): anchored at the top centre.
        UIPopoverPresentationController *popover = sheet.popoverPresentationController;
        if (popover != nil) {
            popover.sourceView = top.view;
            popover.sourceRect = CGRectMake(CGRectGetMidX(top.view.bounds), 0, 1, 1);
            popover.permittedArrowDirections = UIPopoverArrowDirectionUp;
        }
        [top presentViewController:sheet animated:YES completion:nil];
    });
}
