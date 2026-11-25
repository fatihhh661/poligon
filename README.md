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
