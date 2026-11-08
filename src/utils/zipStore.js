import fs from "node:fs";
import zlib from "node:zlib";
import { once } from "node:events";

// Escritor de ZIP "store" (sem compressão) direto pro disco, sem dependências.
// Páginas de mangá já são imagens comprimidas, então comprimir de novo só gasta CPU.
// Cada arquivo é gravado assim que chega, então a RAM não cresce com o capítulo.

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

export class ZipStoreWriter {
  constructor(filePath) {
    this.stream = fs.createWriteStream(filePath);
    this.offset = 0;
    this.entries = [];
    this.stamp = dosDateTime();
  }

  async #write(buffer) {
    this.offset += buffer.length;
    if (!this.stream.write(buffer)) {
      await once(this.stream, "drain");
    }
  }

  async addFile(name, data) {
    const nameBuffer = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const header = Buffer.alloc(30);

    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    header.writeUInt16LE(0, 8); // método 0 = store
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);

    const localOffset = this.offset;
    await this.#write(header);
    await this.#write(nameBuffer);
    await this.#write(data);

    this.entries.push({ nameBuffer, crc, size: data.length, localOffset });
  }

  async finish() {
    const centralStart = this.offset;

    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(this.stamp.time, 12);
      header.writeUInt16LE(this.stamp.day, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.size, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.nameBuffer.length, 28);
      header.writeUInt32LE(entry.localOffset, 42);
      await this.#write(header);
      await this.#write(entry.nameBuffer);
    }

    const centralSize = this.offset - centralStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    await this.#write(end);

    await new Promise((resolve, reject) => {
      this.stream.once("error", reject);
      this.stream.end(resolve);
    });
  }

  abort() {
    this.stream.destroy();
  }
}
