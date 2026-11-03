#import <React/RCTBridgeModule.h>
extern "C" void jnbot_needle_register(void);

@interface JNbotNeedle : NSObject <RCTBridgeModule>
@end
@implementation JNbotNeedle
RCT_EXPORT_MODULE_NO_LOAD(JNbotNeedle, JNbotNeedle)
+ (void)load { jnbot_needle_register(); }
@end
