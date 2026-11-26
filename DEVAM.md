# Poligon Pro: Devam Notu (yeni oturum için)

Bu dosya, programı bugüne kadar geliştiren oturumun özetidir. Yeni oturum işe başlamadan önce bunu ve README.md'yi okumalı.

## Kullanıcı ve amaç
- Kullanıcı bir askeri eğitim merkezinde çalışıyor. Arayüz ve iletişim **Türkçe**.
- Laptop: Windows, **RTX 3060**, 32 GB RAM.
- **Poligon Pro**, atış poligonu parkur tasarımı ve canlandırma programı:
  - Sürükle-bırak elemanlar: tahtalar, pencereli/kapılı engeller, hedefler, kum torbası, varil vb.
  - Mesafe okları, kamera açıları, sinematik açılış.
  - **Oynama Modu**: gerçekçi bir askerle parkuru koşma ve **MP4 video** çıkışı. Brifing ve sunumlarda kullanılıyor.
- Teslim biçimi: Windows exe.

## Kullanıcının kesin istekleri
- **"Basit yapma."** Profesyonel, üst düzey bir oyun kalitesi bekliyor. "Atari / çocuksu" görüntüden hiç hoşlanmıyor.
- **"Diğer mekanikleri bozma."** Yeni özellik eklerken mevcut her şey çalışmaya devam etmeli.
- **"Kod yazma, sadece sohbet"** dediğinde yalnızca konuş, kodu değiştirme.
- Gerçek bir piyasa oyununun (PUBG, Bodycam vb.) birebir kopyası değil, o *kalitede* özgün bir program istiyor.
- Değişikliklerden önce ve sonra ekran görüntüsü göstermek iyi karşılanıyor.

## Teknik yapı (özet; ayrıntı README.md'de)
- **Electron 33** + **Three.js 0.170**. Kaynak `src/`, sayfa ve varlıklar `app/`, Electron ana süreci `electron/main.js`.
- `src/engine.js`:
  - Görüntü işleme hattı: EffectComposer, GTAO, Outline, renk derecelendirme.
  - Kalite ön ayarları: `dusuk`, `orta`, `yuksek`, `ultra`.
  - Uyarlamalı çözünürlük ve `capture(w,h)` ile PNG dışa aktarımı.
- `src/environment.js`: HDR gökyüzü, arazi ve set, çakıl zemin, ağaçlar (**düz kart dallar**), kaya ve çalılar.
- `src/objects.js`: bütün parkur elemanları.
- `src/soldier.js`, asker rigi:
  - Hareketler CMU mocap'ten (`app/assets/anim/mocap.json`).
  - Kollar tüfekte iki kemikli IK ile.
  - Duruşlar: ayakta, diz, alçak çökme, yüzüstü sürünme.
  - Q/E eğilme, nefes, silah salınımı, şarjör değiştirme animasyonu.
- `src/play.js`, oynama modu:
  - 3. ve 1. şahıs kamera (V), dinamik nişangâh, şarjör.
  - Kovan ve duman efektleri, kurallar.
  - Video kaydı (K) ve sinematik tekrar izleme.
- Varlıklar:
  - Poly Haven (CC0) doku, HDR ve modelleri.
  - Sketchfab'den asker ve M4 (CC-BY). Atıflar Hakkında penceresinde.
- Paketleme: `node scripts/package.mjs`. Çıktı: `dist/PoligonPro-Kurulum.zip` ve taşınabilir exe.
- Önceki oturum bulutta ekran kartı olmadan çalıştı. Bu yüzden testleri yalnızca **Düşük** kalitede görebildi; Yüksek ve Ultra ekranı siyah çiziyordu. **Gerçek görüntüyü ilk kez bu laptopta göreceksin.**

## Çözülmüş sorunlar (tekrar bozulmasın)
- Exe açılıp kapanıyordu: `executableName: "PoligonPro"` ile düzeldi.
- Pencere yüksekliği insan boyuna göre ayarlandı. Kapı kanadına çarpışma eklendi.
- Ateş ederken çıkan siyah kareler: GTAO artık sprite'ları atlıyor.
- Kağıt hedefler uzaktan siyah görünüyordu: polygonOffset ve yakın düzlem (near) 0.05 ile düzeldi.
- Nişangâh merminin gerçekten isabet edeceği yeri gösteriyor. Engel arkasındaki hedef vurulamıyor.
- Yüzüstü duruş ve nizami sürünme düzeltildi. Ayak zemine gömülmüyor.
- Tekrar izlemede silahın uçup gitmesi: yay hesabı alt adımlara bölündü.

## Sıradaki iş (kullanıcının onayladığı yön)
1. **Önce programı Yüksek kalitede çalıştır, ekran görüntüsü al ve dürüstçe değerlendir.**
2. Çevre grafikleri. Sahneyi "atari" gösteren asıl bunlar:
   - Kum torbaları çizgi film gibi, turuncu ve yuvarlak. Gerçek bez dokulu, çökük torbalar olmalı.
   - Ağaçlar düz kartlardan yapılmış. Taranmış ve gerçekçi çam ya da impostor yöntemi gerekiyor.
   - Zemin dümdüz ve tek renk. Ayak izi, çukur, renk farkı ve çakıl kümeleri eklenmeli.
   - Toprak set ve tepeler kum tepesi gibi pürüzsüz.
   - Atmosfer: uzak pus ve hava perspektifi yok.
   - TAA ve daha keskin görüntü filtresi.
3. Daha sonra, kullanıcı seçerse:
   - PUBG kalitesinde hareket: atalet, başlama ve durma geçişleri, çömelerek yürüme, serbest bakış (Alt).
   - Geri tepme deseni, balistik, zemine göre ayak sesleri.
   - **Bodycam tarzı** 1. şahıs modu. Kullanıcı fikri beğendi, henüz "ekle" demedi.
4. Her yeni sürümden sonra exe ve zip'i yeniden paketle.

## Git
- Çalışma dalı: `claude/brave-hawking-5z6ze4`.
- Commit mesajları Türkçe.
