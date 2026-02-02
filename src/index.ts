/** biome-ignore-all lint/correctness/noUnusedVariables: (˶˃ ᵕ ˂˶) .ᐟ.ᐟ */
import { read } from "image-js";
import fs from "node:fs/promises";
import path from "path";
import { convertRgbToLab, type RGBColorArray } from "delta-e-ts";

type ImagePixelData = RGBColorArray[];

const DATA_DIR = path.join(import.meta.dir, "../data");

const BASE_URL = "https://r74n.com/pixelflags/";
const PAGE_CONTENT = path.join(DATA_DIR, "page.html");
const CATAGORIES = path.join(DATA_DIR, "catagories");
const FLAG_PIXEL_DATA = path.join(DATA_DIR, "flags/all_flags_rgba.json");
const FLAG_URLS = path.join(DATA_DIR, "flags/flag_urls.json");
const RGB_FLAG_DATA = path.join(DATA_DIR, "flags/rgb");
const LAB_FLAG_DATA = path.join(DATA_DIR, "flags/lab");
const FLAG_IMAGES = path.join(DATA_DIR, "flags/images");

const FLAG_DIMENSIONS = {
    height: 18, //px
    width: 32, //px
};

async function fetchPage() {
    const response = await fetch(BASE_URL);
    const body = response.body;
    if (body === null) {
        throw new Error("response body is blank");
    }
    const content = await body.text();
    await Bun.write(PAGE_CONTENT, content);
}

async function parseUrls() {
    const pageContent = await Bun.file(PAGE_CONTENT).text();

    const countries: Record<string, string> = {};
    const namePattern = new RegExp(/Flag\sof\s(.*)/);

    const formatter = new HTMLRewriter().on("img", {
        element(el) {
            const alt = el.getAttribute("alt");
            const src = el.getAttribute("src");
            if (src === null || alt === null) return;

            const url = new URL(src, BASE_URL).toJSON();

            const flagName = namePattern.exec(alt)?.[1];
            if (flagName === undefined) {
                countries[alt] = url;
            } else {
                countries[flagName] = url;
            }
        },
    });

    formatter.transform(pageContent);
    try {
        const json = JSON.stringify(countries, null, 4);
        await Bun.write(FLAG_URLS, json);
    } catch (e) {
        console.log(e);
        process.exit(1);
    }
}

async function downloadImages() {
    const start = Bun.nanoseconds();
    const flags: Record<string, string> = await Bun.file(FLAG_URLS).json();
    const promises = [];

    for (const [country, url] of Object.entries(flags)) {
        promises.push(
            Bun.write(`${FLAG_IMAGES}/${country}.png`, await fetch(url)),
        );
    }

    await Promise.all(promises);
    console.log(
        "Images downloaded in ",
        (Bun.nanoseconds() - start) / 1e9,
        " seconds",
    );
}

async function getImageData(fname: string): Promise<ImagePixelData> {
    const image = await read(fname);
    if (
        image.height !== FLAG_DIMENSIONS.height ||
        image.width !== FLAG_DIMENSIONS.width
    ) {
        throw new Error(`${fname} is not in standard dimensions`);
    }

    const pixels = [];
    for (let idx = 0; idx < FLAG_DIMENSIONS.width; idx++) {
        for (let jdx = 0; jdx < FLAG_DIMENSIONS.height; jdx++) {
            pixels.push(image.getPixel(idx, jdx));
        }
    }

    return pixels as unknown as ImagePixelData;
}

async function processImages() {
    const flagData: Record<string, ImagePixelData> = {};
    const countries = Object.keys(await Bun.file(FLAG_URLS).json());

    for (const country of countries) {
        const imgpath = path.join(DATA_DIR, `images/${country}.png`);
        flagData[country] = await getImageData(imgpath);
        console.log(country);
    }

    await Bun.write(FLAG_PIXEL_DATA, JSON.stringify(flagData, null, 2));
}

async function splitCHUNGUSImageData() {
    const catagories: string[] = await Bun.file(
        path.join(CATAGORIES, "list.json"),
    ).json();
    const chungus: Record<string, ImagePixelData> =
        await Bun.file(FLAG_PIXEL_DATA).json();

    for (const catagory of catagories) {
        const countries: string[] = await Bun.file(
            path.join(CATAGORIES, `${catagory}.json`),
        ).json();

        const data: Record<string, ImagePixelData> = {};

        for (const country of countries) {
            const imageData = chungus[country];
            if (imageData === undefined) {
                console.log("No data found for country " + country);
                continue;
            }
            data[country] = imageData;
        }

        await Bun.write(
            path.join(RGB_FLAG_DATA, `${catagory}.flags.json`),
            JSON.stringify(data),
        );
    }
}

async function convertFlagDataToLab() {
    const files = await fs.readdir(RGB_FLAG_DATA);
    await Promise.all(
        files.map(async (fpath) => {
            const file = Bun.file(path.join(RGB_FLAG_DATA, fpath));

            try {
                const data: Record<string, ImagePixelData> = await file.json();
                for (const flag of Object.keys(data)) {
                    const pixelArray = data[flag];
                    if (pixelArray === undefined) throw new Error("???");

                    data[flag] = pixelArray.map((p) =>
                        convertRgbToLab(p as unknown as RGBColorArray),
                    );
                }

                // biome-ignore lint/style/noNonNullAssertion: .
                const fname = path.basename(file.name!);
                const f = Bun.file(path.join(LAB_FLAG_DATA, fname));
                console.log(f);
                await f.write(JSON.stringify(data));
                console.log(f);
            } catch (e) {
                console.log("failed to parse json for " + fpath);
                return;
            }
        }),
    );
}

async function generateFlagReadme() {
    const header = `
        Scrapped flags from [https://r74n.com/pixelflags/](https://r74n.com/pixelflags/), along with their RGB and CIELAB arrays

        Structure
        \`\`\`
        data
        ├── catagories     // Files with arrays of flags grouped by catagory
        │   ├── list.json  // Array of catagory names
        │   ├── ...
        ├── flags
        │   ├── all_flags_rgba.json // All flag's RGBA in a single file
        │   ├── flag_urls.json      // URLS of flag images
        │   ├── images/             // Images of flags
        │   ├── lab/                // Flag pixel data as CIE-Lab
        │   ├── rgb/                // Flag pixel data as RGBA
        └── page.html
        \`\`\`

        ---

        Flags (in alphabetical order)

        `;
    const flags: Record<string, string> = await Bun.file(FLAG_URLS).json();
    const dir = path.relative(path.join(import.meta.dir, ".."), FLAG_IMAGES);
    const rows = Object.keys(flags).map((f) => {
        const imageTag = `<img alt="${f}'s flag" loading="lazy" src="./${path.join(dir, f)}.png" height="${FLAG_DIMENSIONS.height}px" width="${FLAG_DIMENSIONS.width}px"/>`; // hard coded extenstion oml
        // return `| ${f} | ${imageTag} |`
        return `${f}\n\n${imageTag}\n\n---\n\n`;
    });
    await Bun.write("README.md", [header, ...rows].join("\n"));
}

async function main() {
    // await fetchPage()
    // await parseUrls()
    // await downloadImages()
    // await processImages();
    // await splitCHUNGUSImageData();
    // await convertFlagDataToLab();
    await generateFlagReadme();
}

await main();
