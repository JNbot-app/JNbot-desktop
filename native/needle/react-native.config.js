const path = require('path');

module.exports = {
  dependency: {
    platforms: {
      ios: { podspecPath: path.join(__dirname, 'jnbot-needle.podspec') },
      android: {
        sourceDir: 'android',
        packageName: 'com.jnbot.needle',
        packageImportPath: 'import com.jnbot.needle.JNbotNeedlePackage;',
        packageInstance: 'new JNbotNeedlePackage()',
      },
    },
  },
};
