package main

/*
#cgo LDFLAGS: -framework CoreFoundation
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <stdlib.h>

// SecTranslocateCreateOriginalPathForURL is exported by Security.framework
// but has no public header, so it is looked up at run time; a macOS without
// it leaves the translocated path as it is.
typedef CFURLRef (*originalPathFunc)(CFURLRef, CFErrorRef *);

static char *translocationOriginal(const char *path) {
	void *security = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY);
	if (security == NULL) {
		return NULL;
	}
	originalPathFunc originalPath = (originalPathFunc)dlsym(security, "SecTranslocateCreateOriginalPathForURL");
	if (originalPath == NULL) {
		return NULL;
	}
	CFURLRef translocated = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path, strlen(path), true);
	if (translocated == NULL) {
		return NULL;
	}
	CFURLRef original = originalPath(translocated, NULL);
	CFRelease(translocated);
	if (original == NULL) {
		return NULL;
	}
	char *result = malloc(PATH_MAX);
	if (result != NULL && !CFURLGetFileSystemRepresentation(original, true, (UInt8 *)result, PATH_MAX)) {
		free(result);
		result = NULL;
	}
	CFRelease(original);
	return result;
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// translocationOriginal is the bundle Gatekeeper translocated to location:
// the Marasi.app the researcher opened, in Downloads for example.
func translocationOriginal(location string) (string, error) {
	path := C.CString(location)
	defer C.free(unsafe.Pointer(path))
	original := C.translocationOriginal(path)
	if original == nil {
		return "", fmt.Errorf("macOS did not say where %s was translocated from", location)
	}
	defer C.free(unsafe.Pointer(original))
	return C.GoString(original), nil
}
