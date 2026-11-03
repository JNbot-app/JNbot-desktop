

const mapTextures:Record<string, ()=> [Promise<typeof import("*.png")>,Promise<{textures:  Record<string, number>,version:string}>]> = {
  "1.18": () => [import("renderer/assets/blockTextures/blocks-1.18.png"), import("../../../../assets/blockTextures/texture-map-1.18.json")],
  "1.8": () => [import("renderer/assets/blockTextures/blocks-1.8.png"), import("../../../../assets/blockTextures/texture-map-1.8.json")],
  "1.16":() => [import("renderer/assets/blockTextures/blocks-1.16.png"), import("../../../../assets/blockTextures/texture-map-1.16.json")],
  "1.21":() => [import("renderer/assets/blockTextures/blocks-1.21.png"), import("../../../../assets/blockTextures/texture-map-1.21.json")],

}

export default mapTextures;
