#include <jni.h>
extern "C" void jnbot_needle_register(void);
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM*, void*) {
  jnbot_needle_register();
  return JNI_VERSION_1_6;
}
