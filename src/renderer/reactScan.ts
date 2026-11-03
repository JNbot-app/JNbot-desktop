
if (__REACT_SCAN_ENABLED__) {
  void import('react-scan').then(({ scan }) => {
    scan({
      enabled: true,
      trackUnnecessaryRenders: true,
    });
  });
}
