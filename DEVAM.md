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

## 3. oturumda çözülenler (27.11.2026)
- **Oynama Modu 30 → 72 FPS** (Yüksek, 1920x994, RTX 3060). Profil: kare başına 33 ms'nin 27 ms'i `traceShot` içindeydi. Sebep: parkurdaki asker figürü (iskeletli, 87 bin köşe); three.js iskeletli modelde BVH kullanmaz, her köşeyi kemikle dönüştürür. Çözüm `play.bakeRayProxy`: oyuna girerken figürün sabit pozu görünmez, BVH'li bir ışın gövdesine pişirilir; iskeletli modelin `raycast`'i kapatılır. Şimdi `traceShot` 0,3 ms, oyun mantığı toplam ~1,7 ms.
- **1. şahısta koşarken ekrana giren parça**: baş kemiğine %100 bağlı kulaklık/mikrofon parçası (`RetopoFlow_015001`, malzeme adı "Mark_Pouches") isim kuralına takılmadığı için gizlenmiyordu. `setFirstPerson` artık köşe ağırlığının >%60'ı baş kemiğinde olan her parçayı da gizliyor (`headWeight`).
- **1. şahıs kamera duvara girmesi**: göz noktası gövde çarpışma yarıçapından öndeydi; `fpCamFrom` göz noktasını da engellere karşı itiyor (`collide(eye, 0.1, false)`).
- Profil betiği yöntemi: CDP ile `play.tick`, `rig.update`, `traceShot`, `drawHud`, `composer.render` ve geçişler sarmalanıp kare başına ms ölçüldü.

## 4. oturum: asker mekaniği (27.11.2026)
Kullanıcı fotoğraflarla şikâyet etti: sola eğilince asker hedefi kapatıyor, nişangâh sarı ve kayıyor, yürüyüş ve kollar "berbat". Yapılanlar:
- **Silah duruşu katmanı** (`soldier.js` → `uprightTorso`, `uprightReference`): bacak/kalça CMU kaydından; gövde, boyun, baş, köprücükler modelin dik T-pozuna göre tutulur (%80, kayıttan %20 canlılık). Öne eğilme hız, depar (`state.sprint`), ivme (`state.accel`) ve çömelik yürümeye göre. CMU Idle kaydı çok kambur olduğu için asker "zombi" gibi duruyordu.
  - DİKKAT: canlı iskelete `skeleton.pose()` uygulama; bu modelde kök kemik ölçeğini iki kez çarpıp askeri 100 kat küçültüyor. Referans ayrı kopyadan okunur.
- **Tüfek pozları**: alçak hazır (namlu ileri-aşağı ~20°), yürürken sıkıştırılmış hazır, deparda göğüs önünde çapraz (port arms), dirsekler aşağı ve gövdeye yakın.
- **Hareket**: atalet (hızlanma ~0,3 sn, depar daha uzun, durma ~0,2 sn); çarpışmada hız gerçek yer değiştirmeye iner (duvara yaslanınca bacaklar koşuda donmuyordu); ayakta yürüyüşte diz bükümü 8,5 → 4 cm.
- **Çömelerek yürüme**: C ile diz çökünce W ile yürünür; diz pozu ↔ çömelik yürüyüş yumuşak geçiş (`_cw`).
- **Serbest bakış (Alt)**: yalnızca kamera döner, bırakınca geri gelir; bu sırada nişangâh gizli ve ateş yok.
- **Sola köşe açma**: 3. şahıs kamera Q ile sol omza geçer (`camFor` içinde `side`).
- **Nişangâh**: ekran merkezinde sabit ve beyaz. Mermi göz/namlu hattından gider; engel varsa çarpacağı yerde küçük kırmızı daire+X uyarısı.
- **Tekrar izleme hatası (önceden vardı)**: "Yeniden Başla"dan sonra `_lastSnap` sıfırlanmadığı için kayıt tutulmuyordu. Kayda depar/ivme alanları eklendi (eski kayıtlar da okunur).

## 5. oturum: gerçekçi yürüyüş motoru (27.11.2026, bulut)
Kullanıcı: "yürümesinin gerçeklik ile alakası yok". Ölçüm (ayak yere basarken kayma hızı): eski sistemde 0,24–1,4 m/sn (yana ve çaprazda en kötü). Sebep: oyun hızları ile CMU kayıtlarının adım boyları uyuşmuyordu (yan adım kaydı 0,47 m/sn iken oyunda 1,3 m/sn; kadans yapay olarak 1,6 katına çıkıyordu).
Yeni sistem (`soldier.js`: `stepLoco`, `initFeet`, `planFeet`, `legsTo`):
- **Kadans tablosu** (gerçek insan verisi): hız → adım/dk → istenen adım boyu → adım esnetme (`loco.warp`).
- **Kalça yön dönüşü**: kalça gidilen yöne en fazla 50° döner (`loco.theta`, histerezisli ileri/geri yarım küre), kalan açı adım yönünü döndürür. Yan adım klipleri (StrafeL/R) artık kullanılmıyor.
- **Ayak kilidi**: temas kayıttaki bilek yüksekliğinden (`contact` tablosu, 64 örnek). Basan ayağın parmak tabanı yere kilitlenir; havadaki ayak kalktığı yerden, kalçanın varacağı yere göre öngörülen iniş noktasına gider (iniş, basış yolunun %42'si önde). Yükseklik eğrisi kayıttan.
- **Topuk kalkışı**: geride kalan ayak bacak boyunu aşınca parmak tabanı etrafında döner.
- **Kalça yüksekliği bacaklardan** (ters sarkaç): basan bacak ortada ~%99 düz, çift destekte kalça alçalır. `hipOff`: kayıtların kalçası modele göre alçaktı (çömelik yürüyüş).
- **Duruş ve yerinde dönüş**: ayaklar yerde kalır, kalça dönünce ya da ayak duruşu bozulunca düzeltme adımı atılır (`play.js` artık dönüşte yürüyüş klibini zorlamıyor).
- Hızlar: yürüyüş 1,5; geri 0,95; yana 1,15 (önce 1,6 / 1,15 / 1,3). Depar 4,2 aynı.
- Sonuç: basan ayakta kayma ≈ 0 (ölçüm betiği: ayak modu `plant` iken parmak tabanı hızı).
- Bulutta GPU yok; görüntüler Düşük kalitede kare kare doğrulandı. **Laptopta gerçek akıcılıkta izlenip ince ayar yapılmalı** (diz bükümü, ayak kaldırma yüksekliği, kalça dönüş sınırı).

## 6. oturum: tüfek tutuşu, duruşlar, bacak açıklığı (27.11.2026, bulut)
Kullanıcı: el silahın içine giriyor, bacaklar iç içe, koşarken silah/kol duruşu gerçek değil.
Bulunanlar (ölçüm): sağ el hedefi (`gripR` z=0,21) dipçiğin içindeydi; sol omuz → el kundağı 0,74–0,79 m, kol (omuz→bilek) yalnızca 0,458 m, yani sol el hiç yetişmiyordu; sol elin parmak bükme yönü terstı (avuç açık görünüyordu).
Yapılanlar (`soldier.js`):
- `setupCurl`: el çerçevesi (F parmak, T başparmak, P avuç; sağda F×P=T, solda P×F=T) ve doğru bükülme yönü. `curl(side, amount, {index, thumb})`: işaret parmağı nişan dışında tetik dışında düz, başparmak da bükülüyor.
- `gripHand(side, C, Fw, Pw, pole)`: avuç ortasını silah yüzeyindeki noktaya, eli istenen açıyla oturtur; ön kola %65 burulma verir.
  - Sağ el: kabza ekseni (aşağı-geri ~37°), `W.gripLocal`.
  - Sol el: el kundağının altında, avuç yukarı-içe; kolun yetiştiği en öndeki noktayı arar.
- Tüfek boyu 0,84 → 0,78 m (modelin kısa koluna göre). Tüfekli duruşta gövde ~24° sağa döner (sol omuz önde), baş ileri bakar.
- Duruşlar:
  - Dipçik her zaman omuz cebinde.
  - Alçak hazırda namlu ~28°, yürürken ~19° aşağı.
  - Koşuda tüfek göğüs önünde çapraz: kabza sağ kalça önünde, namlu sol-aşağı.
- Bacaklar: ayak merkezi kalçadan en az 11 cm yanda; havadaki ayak diğerinin yanından dışa kavisle geçer; dizler hafif dışa bakar.
- Doğrulama Düşük kalitede yakın çekim karelerle yapıldı. **Laptopta canlı izlenmeli:** parmakların kavrayışı, sol elin el kundağındaki yeri, gövde dönüş açısı (`bl = -0.42`).

## Sıradaki iş
1. Asker mekaniğinde kalanlar (kullanıcı isterse): geri tepme deseni, zemine göre ayak sesleri, bodycam tarzı 1. şahıs, ayakta/çömelik geçişinde ara animasyon, koşarken ani yön değiştirmede gövde yatışı.
2. Oynama Modu'nda ara sıra ~35 ms'lik tekil kare takılmaları var (ortalama 72 FPS). Muhtemelen çöp toplama veya gölge haritası; video kaydında fark edilirse incelenmeli.
3. Çevre için kalan iyileştirmeler (kullanıcı isterse):
   - Gerçek TAA (hareket vektörlü) yapılmadı; three.js WebGL hattında büyük iş. Şu an MSAA + SMAA + CAS.
   - Ağaçlar hâlâ kart tabanlı; çok yakından (5 m altı) kart yapısı seçilebilir. Taranmış çam modeli (ör. Poly Haven) indirilirse yakın LOD'da kullanılabilir.
   - Arka set yüzeyi hâlâ biraz düzgün/sarı; doku tabanlı mermi deliği maskesi eklenebilir.
4. **Bodycam tarzı** 1. şahıs modu: kullanıcı fikri beğendi, henüz "ekle" demedi. Balistik de bekliyor.
5. Her yeni sürümden sonra exe ve zip'i yeniden paketle (masaüstündeki `PoligonPro.exe` kopyasını da güncelle).

## Git
- Çalışma dalı: `claude/brave-hawking-5z6ze4`.
- Commit mesajları Türkçe.
