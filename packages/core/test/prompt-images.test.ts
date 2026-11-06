import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, parsePromptImages } from "../src/prompt-images.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const image = (bytes = png) => ({
  name: "capture.png",
  mimeType: "image/png",
  data: bytes.toString("base64"),
});
describe("validation des images jointes", () => {
  it("accepte les quatre signatures et refuse les données altérées", () => {
    expect(
      parsePromptImages([
        image(),
        {
          name: "a.jpg",
          mimeType: "image/jpeg",
          data: Buffer.from([255, 216, 255]).toString("base64"),
        },
        { name: "a.gif", mimeType: "image/gif", data: Buffer.from("GIF89a").toString("base64") },
        {
          name: "a.webp",
          mimeType: "image/webp",
          data: Buffer.from("RIFF0000WEBP").toString("base64"),
        },
      ]),
    ).toHaveLength(4);
    expect(parsePromptImages([{ ...image(), data: "AAAA" }])).toBeNull();
    expect(parsePromptImages([{ ...image(), data: `${image().data}=` }])).toBeNull();
    expect(parsePromptImages([{ ...image(), name: "../a" }])).toBeNull();
    expect(parsePromptImages([{ ...image(), extra: true }])).toBeNull();
    expect(parsePromptImages(Array(11).fill(image()))).toBeNull();
  });
  it("accepte 5 Mio sans débordement de pile et refuse plus", () => {
    const bytes = Buffer.alloc(MAX_IMAGE_BYTES);
    png.copy(bytes);
    expect(parsePromptImages([image(bytes)])).toHaveLength(1);
    expect(parsePromptImages([image(Buffer.concat([bytes, Buffer.alloc(1)]))])).toBeNull();
    expect(parsePromptImages([image(bytes), image(bytes), image(bytes)])).toBeNull();
  });
});
