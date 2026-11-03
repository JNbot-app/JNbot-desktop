package com.jnbot.needle;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;

public class JNbotNeedlePackage implements ReactPackage {
  static { System.loadLibrary("jnbot_needle"); }
  @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) {
    return Collections.singletonList(new ReactContextBaseJavaModule(context) {
      @Override public String getName() { return "JNbotNeedle"; }
    });
  }
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) {
    return Collections.emptyList();
  }
}
