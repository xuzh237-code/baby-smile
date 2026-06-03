const cloudConfig = require('./utils/cloudConfig');

App({
  globalData: {
    cloudReady: false
  },

  onLaunch() {
    if (cloudConfig.CLOUD_ENV_ID && wx.cloud) {
      wx.cloud.init({
        env: cloudConfig.CLOUD_ENV_ID,
        traceUser: true
      });
      this.globalData.cloudReady = true;
    }
  }
});
