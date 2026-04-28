//go:build darwin

package view

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework Foundation
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static BOOL AIMDIsImagePath(NSString *path) {
	NSString *ext = [[path pathExtension] lowercaseString];
	return [ext isEqualToString:@"png"] ||
		[ext isEqualToString:@"jpg"] ||
		[ext isEqualToString:@"jpeg"] ||
		[ext isEqualToString:@"gif"] ||
		[ext isEqualToString:@"webp"] ||
		[ext isEqualToString:@"svg"];
}

static char* AIMDPasteboardImagePathsJSON(void) {
	@autoreleasepool {
		NSPasteboard *pb = [NSPasteboard generalPasteboard];
		NSMutableArray *paths = [NSMutableArray array];
		NSDictionary *options = @{NSPasteboardURLReadingFileURLsOnlyKey: @YES};
		NSArray *urls = [pb readObjectsForClasses:@[[NSURL class]] options:options];
		for (NSURL *url in urls) {
			if (![url isFileURL]) {
				continue;
			}
			NSString *path = [url path];
			if (AIMDIsImagePath(path)) {
				[paths addObject:path];
			}
		}
		NSError *err = nil;
		NSData *json = [NSJSONSerialization dataWithJSONObject:paths options:0 error:&err];
		if (err != nil || json == nil) {
			return strdup("[]");
		}
		NSString *str = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
		if (str == nil) {
			return strdup("[]");
		}
		return strdup([str UTF8String]);
	}
}

static char* AIMDChooseImagePathsJSON(void) {
	@autoreleasepool {
		NSOpenPanel *panel = [NSOpenPanel openPanel];
		[panel setCanChooseFiles:YES];
		[panel setCanChooseDirectories:NO];
		[panel setAllowsMultipleSelection:YES];
		[panel setAllowedFileTypes:@[@"png", @"jpg", @"jpeg", @"gif", @"webp", @"svg"]];
		[panel setPrompt:@"Insert"];
		NSInteger result = [panel runModal];
		if (result != NSModalResponseOK) {
			return strdup("[]");
		}
		NSMutableArray *paths = [NSMutableArray array];
		for (NSURL *url in [panel URLs]) {
			if ([url isFileURL] && AIMDIsImagePath([url path])) {
				[paths addObject:[url path]];
			}
		}
		NSError *err = nil;
		NSData *json = [NSJSONSerialization dataWithJSONObject:paths options:0 error:&err];
		if (err != nil || json == nil) {
			return strdup("[]");
		}
		NSString *str = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
		if (str == nil) {
			return strdup("[]");
		}
		return strdup([str UTF8String]);
	}
}
*/
import "C"

import (
	"encoding/json"
	"unsafe"
)

func pasteboardImagePaths() []string {
	return jsonStringToPaths(C.AIMDPasteboardImagePathsJSON())
}

func chooseImagePaths() []string {
	return jsonStringToPaths(C.AIMDChooseImagePathsJSON())
}

func jsonStringToPaths(raw *C.char) []string {
	if raw == nil {
		return nil
	}
	defer C.free(unsafe.Pointer(raw))
	var paths []string
	if err := json.Unmarshal([]byte(C.GoString(raw)), &paths); err != nil {
		return nil
	}
	return paths
}
