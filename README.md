# Poligon Pro

Atış parkurlarını sahaya gitmeden önce 3D ortamda tasarlamak, mesafeleri ölçmek, emniyet kontrolü yapmak ve personele sunmak için masaüstü programı. Tamamen Türkçe ve çevrimdışı çalışır.

## Kurulum (Windows)

1. `PoligonPro-Windows.zip` dosyasını indirin ve bir klasöre çıkarın (sağ tık → **Tümünü ayıkla**).
2. `PoligonPro-win32-x64` klasöründeki **PoligonPro.exe** dosyasını çift tıklayın.
3. Windows "bilgisayarınızı korudu" uyarısı verirse **Ek bilgi → Yine de çalıştır** deyin (program imzasız olduğu için bu uyarı çıkar).

Kurulum gerekmez. Masaüstüne kısayol için `PoligonPro.exe` → sağ tık → **Gönder → Masaüstü (kısayol oluştur)**.

## Özellikler (1. aşama)

- Sinematik açılış animasyonu ve ana menü
- Fotoğraf referanslı 3D poligon sahnesi: çakıl zemin, toprak setler, dağlar, çam ormanı, gölgelik
- 25 elemanlık kütüphane: silüet/mini/dost hedefler, çelik popper ve plakalar, tahta paravan, pencereli paravan, kapı, barikat, kum torbası, varil, palet, lastik, atış kaidesi, atış kutusu, başlangıç noktası, hata çizgisi, yön oku, koni, işaret direği, yazı etiketi, asker figürü
- Sürükle-bırak yerleştirme, taşıma, döndürme, uzunluk ayarlama, geri al/ileri al
- Oklu mesafe ölçümü ve atış noktası–hedef mesafelerinin otomatik gösterimi
- Kamera görünümleri: kuşbakışı, perspektif, atıcı gözü, hedef arkası, yan, drone turu
- Emniyet kontrolü (180° kuralı, çelik hedef mesafesi, sınır dışı hedef)
- Parkur bilgileri ve brifing, mesafe tablosu, harita
- `.parkur` dosyası olarak kaydet/aç, otomatik yedek, yüksek çözünürlüklü PNG
- Ayarlar: grafik kalitesi, günün saati, birlik adı ve logo

## Geliştirme

```bash
npm install
npm start        # derle ve masaüstünde çalıştır
npm run paket    # Windows paketi üret (dist/)
```

## Grafik varlıkları

Gerçekçi görünüm için Poly Haven'ın CC0 (serbest lisanslı) fotoğraf tabanlı dokuları, HDR gökyüzleri ve taranmış modelleri kullanılır (`app/assets`). Yeniden indirmek için:

```bash
node scripts/fetch-assets.mjs
python3 scripts/make-branch.py
```

## Uygulama Modu (askerle parkur + video)

Araç çubuğundaki **Uygulama Modu** (veya `P`) ile asker başlangıç noktasında belirir. W A S D ile yürüyün, Shift ile koşun, fareyle bakın, sağ tıkla nişan alın, sol tıkla ateş edin; C diz çökme, Z yüzüstü. **Kayıtla Başla** veya `R` ile ekran, süre/isabet bilgileri ve atış sesleriyle birlikte MP4 video olarak kaydedilir.

### Mixamo ile daha gerçekçi asker (isteğe bağlı)
mixamo.com'dan (ücretsiz Adobe hesabı) bir asker karakteri (FBX, With Skin) ve tüfekli yürüme/koşma/nişan/ateş animasyonları (FBX, Without Skin, In Place) indirip depodaki `modeller/` klasörüne yükleyin; program bunlarla güncellenecektir.

### Hareket kayıtları (mocap)
Asker hareketleri CMU Hareket Yakalama Veritabanı'ndan (ticari kullanım dahil serbest) alınır. `dist/mocap/*.bvh` dosyalarından döngüsel, yerinde klipler üretmek için: `node scripts/prep-mocap.mjs` → `app/assets/anim/mocap.json`.

### Hareket kütüphanesi (100STYLE)

Varsayılan hareket kütüphanesi `app/assets/anim/lib/100style-neutral.json` dosyasıdır (`app/assets/anim/library.json` içindeki `active`). Kaynak: **The 100STYLE Dataset – Ian Mason, Sebastian Starke, Taku Komura** (CC BY 4.0, https://zenodo.org/records/8127870; Mason vd., "Real-Time Style Modelling of Human Locomotion via Feature-Wise Transformations and Local Motion Phases", ACM CGIT 2022, doi:10.1145/3522618). Bekleme, yürüyüş ve geri yürüyüş Neutral stilinden, koşu aynı oyuncunun Rushed stilinden alınır.

Yeniden üretmek için 100STYLE.zip içinden `100STYLE/Neutral/*.bvh` ve `100STYLE/Rushed/Rushed_FR.bvh` dosyalarını tek klasöre koyup:
`node scripts/import-anim.mjs scripts/anim-sources/100style-neutral.json <klasör>`

Eski CMU kliplerine dönmek için geliştirici konsolunda `localStorage.setItem('pp.animLib','cmu')` ve yeniden yükleme; varsayılana dönmek için `localStorage.removeItem('pp.animLib')`. Kütüphane yüklenemezse program otomatik olarak `mocap.json` (CMU) dosyasına düşer.
