// esbuild injects every export as a global symbol. Keep this module limited to
// the one valid identifier we need; injecting mobileHttp's default Axios export
// would emit an invalid `default` variable in the CommonJS bundle.
export { fetch } from './mobileHttp';
