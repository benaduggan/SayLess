declare module "pako" {
  export interface PakoApi {
    gzip(input: string | Uint8Array): Uint8Array;
  }

  const pako: PakoApi;
  export default pako;
}
