// Şifreli hareket kütüphanesi (.pak) — lisanslı hareket verisi (ActorCore) uygulamaya yalnızca bu biçimde
// girer: ActorCore EULA'sı verinin "derlenmiş, tescilli ya da şifreli" paketlenmesini, son kullanıcının dosyayı
// açıp başka 3B yazılımlarda kullanamamasını şart koşar.
// Biçim: 'PPAK1' (5 bayt) + IV (12 bayt) + AES-256-GCM( gzip(JSON) ) (etiket sonda, WebCrypto düzeni).
// Aynı modül içe aktarma betiğinde (Node) şifrelemek, oyunda (tarayıcı) çözmek için kullanılır.
export const PAK_MAGIC = 'PPAK1';
const PASS = 'PoligonPro/anim-pak/v1:9c4e7b1f2a6d48e3b05f71c2d8a9e6b4';

async function keyBytes(subtle) {
  return new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(PASS)));
}

/** Tarayıcı: .pak baytlarını çözüp JSON nesnesine çevirir. */
export async function openPak(buf) {
  const u8 = new Uint8Array(buf);
  const magic = new TextDecoder().decode(u8.subarray(0, 5));
  if (magic !== PAK_MAGIC) throw new Error('geçersiz hareket paketi');
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', await keyBytes(subtle), 'AES-GCM', false, ['decrypt']);
  const gz = await subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(5, 17) }, key, u8.subarray(17));
  const text = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

/** Şifreleme anahtarı baytları (içe aktarma betiği şifrelerken aynı anahtarı kullanır). */
export const pakKeyBytes = keyBytes;
