Pod::Spec.new do |s|
  s.name           = 'BakersLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Local Live Activity bridge for the current bake step'
  s.description    = 'Local Live Activity bridge for the current bake step'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
