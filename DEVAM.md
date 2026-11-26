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
- İlk oturum bulutta ekran kartı olmadan çalıştı (yalnızca Düşük kalite görülebildi). **2. oturum (26.11.2026) kullanıcının laptopunda RTX 3060 ile çalıştı**; aşağıdaki çevre grafikleri gerçek donanımda Yüksek/Ultra/Düşük kalitede görülerek ayarlandı.

## Laptop kurulumu (2. oturumda yapıldı)
- Git ve Node.js LTS (v26) winget ile kuruldu. Proje: `C:\Users\Excalibur\Documents\PoligonPro`.
- Node 26 + npm 11: `npm install` electron/esbuild kurulum betiklerini çalıştırmıyor. Electron zip'i `%LOCALAPPDATA%\electron\Cache` içinden `node_modules\electron\dist`'e elle açıldı, `path.txt` = `electron.exe`.
- `scripts/build.mjs`, `fetch-assets.mjs`, `package.mjs`: Windows yol hatası (`C:\C:\...`) `fileURLToPath` ile düzeltildi.
- `npm run paket` Windows'ta çalışır: aynı Node 26 extract-zip hatası için paketleyicinin zip açıcısı `tar.exe` ile değiştirildi, zip de `tar -a` ile üretiliyor. `ekran-goruntuleri/` ve `DEVAM.md` pakete girmez. electron-builder ilk çalıştırmada NSIS araçlarını kendi GitHub sürümlerinden indirir.
- Ekran görüntüsü otomasyonu: `npx electron . --remote-debugging-port=9223` ile açıp CDP üzerinden `window.__pp.engine.capture(2560,1440)`. Sayfa içinden `location.reload()` çalışmaz (`will-navigate` engelli); CDP `Page.reload` kullanılmalı. Görüntüler `ekran-goruntuleri/` (git dışı).

## Çözülmüş sorunlar (tekrar bozulmasın)
- Exe açılıp kapanıyordu: `executableName: "PoligonPro"` ile düzeldi.
- Pencere yüksekliği insan boyuna göre ayarlandı. Kapı kanadına çarpışma eklendi.
- Ateş ederken çıkan siyah kareler: GTAO artık sprite'ları atlıyor.
- Kağıt hedefler uzaktan siyah görünüyordu: polygonOffset ve yakın düzlem (near) 0.05 ile düzeldi.
- Nişangâh merminin gerçekten isabet edeceği yeri gösteriyor. Engel arkasındaki hedef vurulamıyor.
- Yüzüstü duruş ve nizami sürünme düzeltildi. Ayak zemine gömülmüyor.
- Tekrar izlemede silahın uçup gitmesi: yay hesabı alt adımlara bölündü.
- (2. oturum) GTAO derinlik geçişi alfa testini bilmez: yaprak/impostor kartları uzakta dikdörtgen gölge lekesi bırakıyordu → bitki örneklerinde `userData.noAO = true`.
- (2. oturum) Ayrıntılı ve gölge düşüren ağaçlar yalnızca gölge haritası alanında (`nearR`). InstancedMesh örnek başına kırpılmadığı için dışarıdakiler gölge geçişinde boşuna çiziliyor, Oynama Modu'nu ~%15 yavaşlatıyordu.
- (2. oturum) Düşük kalitede MSAA yok: yapraklarda `alphaToCoverage` kapalı olmalı, yoksa beyaz kenar parıltısı çıkar.

## 2. oturumda yapılan çevre grafikleri (hepsi gerçek GPU'da doğrulandı)
- **Kum torbası** (`objects.js`, `textures.js` → `makeBurlap`): prosedürel jüt çuval bezi (renk + normal + pürüzlülük), her torba deforme edilmiş ağ (düz taban, şişkin yan, dikişli yassı uç, altına katlanmış ağız, kırışık, topak, tabanda kir köşe rengi), 6 varyant, şaşırtmalı dizilim, alt sıralar yük altında basık. Kütüphane önizlemesi `app/assets/thumbs/kum.png` yenilendi.
- **Ağaçlar** (`environment.js` → `pineGeometry`, `bakeImpostor`): kademeli dal yapısı, her dalda eğilip sarkan 3 çapraz kart (yatay kart yok), taç içi karanlık/uçlar aydınlık köşe rengi, hacimli normaller, arka yüz normali çevrilmiyor, basit geçirgenlik, gövde kütükleri. 3 katman: yakın (ayrıntılı+gölge), orta (sade), uzak (renk+normal dokusu fırınlanmış impostor çapraz kart, 13 000 ağaç).
- **Zemin** (`floorMask`, `floorShader`): 1024x2048 ayrıntı maskesi (toprak dökülmesi, araç tekerlek izi ve diş izi, ayak izi dizileri, atış hattında aşınma, set dibinde mermi çukurları, çukur/tümsek) + çakıl/toprak karışımı ve normal sapması. Zemin fiziksel olarak düz kaldı (asker `groundY 0.015` kabulü bozulmadı). Kenarlarda taş kümeleri ve ot öbekleri.
- **Setler ve tepeler**: dalgalı etek, değişken sırt, erozyon olukları, dozer izi, topaklar; uçlar araziye yumuşak iner; eğrilikten köşe rengi; arka sette hedef yüksekliğinde koyu darbe bandı. Uzak dağlarda geniş ölçekli sırt/vadi. Kayalar etekte ve sırtta kümelenir.
- **Atmosfer**: three.js sis chunk'ları değiştirildi → yüksekliğe bağlı üstel pus + uzakta doygunluk kaybı (`installAtmosphere`, `setAtmosphere`). Sabah/akşam daha puslu.
- **Görüntü filtresi** (`engine.js`): SMAA (Ultra hariç) + AMD CAS tarzı uyarlamalı keskinleştirme (renk derecelendirme geçişinde).
- **Performans** (RTX 3060, 1920x994, Yüksek): düzenleyici ~87 FPS (önce ~73). Oynama Modu ~27 FPS — **orijinal kodda da aynı**, bitki örtüsünden bağımsız (gizleyince değişmiyor); darboğaz `play.js` tarafında, CPU.

## Sıradaki iş
1. **Oynama Modu performansı**: Yüksek kalitede ~27 FPS (düzenleyici 87). Bitki örtüsü değil; `play.js` döngüsü profillenmeli (ışın atışları, BVH, mocap, HUD tuvali, 3. şahıs kamera çarpışması vb.).
2. Çevre için kalan iyileştirmeler (kullanıcı isterse):
   - Gerçek TAA (hareket vektörlü) yapılmadı; three.js WebGL hattında büyük iş. Şu an MSAA + SMAA + CAS.
   - Ağaçlar hâlâ kart tabanlı; çok yakından (5 m altı) kart yapısı seçilebilir. Taranmış çam modeli (ör. Poly Haven) indirilirse yakın LOD'da kullanılabilir.
   - Arka set yüzeyi hâlâ biraz düzgün/sarı; doku tabanlı mermi deliği maskesi eklenebilir.
3. Daha sonra, kullanıcı seçerse:
   - PUBG kalitesinde hareket: atalet, başlama ve durma geçişleri, çömelerek yürüme, serbest bakış (Alt).
   - Geri tepme deseni, balistik, zemine göre ayak sesleri.
   - **Bodycam tarzı** 1. şahıs modu. Kullanıcı fikri beğendi, henüz "ekle" demedi.
4. Her yeni sürümden sonra exe ve zip'i yeniden paketle.

## Git
- Çalışma dalı: `claude/brave-hawking-5z6ze4`.
- Commit mesajları Türkçe.
