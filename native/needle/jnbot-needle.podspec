require 'json'
model = JSON.parse(File.read(File.join(__dir__, 'model.json')))
Pod::Spec.new do |s|
  s.name = 'jnbot-needle'
  s.version = '1.0.0'
  s.summary = 'Native local inference for the shared JNbot Node backend'
  s.homepage = 'https://github.com/usserwout/JNbot-updater'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'JNbot'
  s.source = { :git => 'https://github.com/usserwout/JNbot-updater.git', :tag => s.version.to_s }
  s.platform = :ios, '15.1'
  s.static_framework = true
  s.source_files = 'ios/*.{h,mm}'
  s.vendored_frameworks = "engine/mobile/#{model['engineRevision']}/JNbotInference.xcframework"
  s.frameworks = 'Accelerate'
  s.libraries = 'c++'
  s.preserve_paths = "engine/mobile/#{model['engineRevision']}/notices/**"
  s.script_phase = {
    :name => 'Verify local inference build',
    :execution_position => :before_compile,
    :script => '"${NODE_BINARY:-node}" "${PODS_TARGET_SRCROOT}/../../scripts/check-needle-build.mjs"'
  }
  s.dependency 'React-Core'
  s.dependency 'nodejs-mobile-react-native'
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'GCC_ENABLE_CPP_EXCEPTIONS' => 'YES',
    'OTHER_CPLUSPLUSFLAGS' => '$(inherited) -DJNBOT_NEEDLE_LINKED -DNAPI_VERSION=8',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_ROOT)/../../node_modules/nodejs-mobile-react-native/ios/libnode/include/node"'
  }
end
