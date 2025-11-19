// Replace the string below with your YouTube Data API v3 key.
const YT_API_KEY = 'AIzaSyDQ3kxcppdSwjKdHQuAtwi3MND-nHtPw8g';

export { YT_API_KEY };
export default {
  YT_API_KEY,
};

// Provide CommonJS export so server (node) can require this file directly.
/* eslint-disable no-undef */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { YT_API_KEY };
}

// Optional: a running scraper server URL (set to your development machine IP when testing on device)
// Example: 'http://192.168.0.106:4000' or 'http://10.0.2.2:4000' for Android emulator
// Set this to your scraper server URL when running the local Node server.
// For devices on the same Wi-Fi use your machine IP, e.g. 'http://192.168.0.106:4000'
// For Android emulator use 'http://10.0.2.2:4000'
export const SCRAPER_SERVER = 'http://192.168.0.106:4000';
if (typeof module !== 'undefined' && module.exports) {
  module.exports.SCRAPER_SERVER = 'http://192.168.0.106:4000';
}
