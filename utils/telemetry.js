const Telemetry = {
  logEvent: (name, payload) => {
    try {
      // lightweight stub: console and future hook for remote telemetry
      console.log('[Telemetry]', name, payload || {});
      // TODO: send to remote endpoint if configured
    } catch (e) {}
  },
  setUser: (id) => { console.log('[Telemetry] setUser', id); }
};

export default Telemetry;
