# Ayrı uygulama olmadan telefondan erişim

Agentic Company OS telefon tarayıcısında çalışır. iOS veya Android için ayrı bir AgenticOS uygulaması gerekmiyor. Arayüz ve `/api` aynı HTTPS adresinden açılmalıdır.

## Önerilen özel bağlantı

Kişisel ve ticari olmayan kullanımda Tailscale'in [Personal planı](https://tailscale.com/pricing) şu anda ücretsizdir. Tailscale Serve, bilgisayardaki yerel web sunucusunu yalnız aynı özel ağa bağlı cihazlara HTTPS ile ulaştırır; alan adı satın almak veya modem portu açmak gerekmez. Telefonda yalnız standart Tailscale ağ istemcisi ve normal tarayıcı kullanılır. Ticari kullanım için Personal planın uygun olduğunu varsaymayın; kendi WireGuard VPN'inizi kullanabilirsiniz.

OSI lisanslı açık kaynak projeyi bir GitHub kuruluşu üzerinden işletenler için Tailscale, ücretsiz bir [Community on GitHub planı](https://tailscale.com/docs/reference/free-plans-discounts) da belgeliyor. GitHub ile kimlik doğrulama ve Tailscale Support ile görüşme gerekir; depoyu herkese açmak bu planı otomatik olarak sağlamaz. Aşağıdaki kendi WireGuard yolunuz Tailscale planına bağımlı değildir.

1. Uygulamayı PostgreSQL, en az 32 karakterlik operatör erişim anahtarı ve derlenmiş arayüzle production modunda kurun. `compose.yaml` sunucuyu bilgisayarda yalnız `127.0.0.1:5000` adresine bağlar. Geçici PGlite geliştirme modunu uzaktan erişimde kullanmayın.
2. Bilgisayar/sunucu ve telefonda Tailscale'e aynı özel ağ hesabıyla giriş yapın. Gerekiyorsa MagicDNS ve HTTPS sertifikalarını açın. Sunucunuzun gerçek `cihaz.tailnet.ts.net` adını bulun.
3. Docker Compose kurulumunun kök `.env` dosyasına kendi adınızla şu iki değeri ekleyin:

   ```dotenv
   TRUSTED_HOSTS=cihaz.tailnet.ts.net
   CORS_ALLOWED_ORIGINS=https://cihaz.tailnet.ts.net
   ```

   İlk değer yalnız alan adıdır, ikincisi tam HTTPS başlangıç adresidir. API kapsayıcısını `docker compose up -d --force-recreate app` komutuyla yeniden başlatın. Docker kullanmıyorsanız aynı değişkenleri production API sürecine verin ve API'yi `HOST=127.0.0.1` ile çalıştırın.

4. Bilgisayarda `tailscale serve --bg 5000` çalıştırın. Çıkan HTTPS adresini `tailscale serve status` ile kontrol edin. **Serve** kullanın; Funnel herkese açık yayın yapar.
5. Telefonda Tailscale bağlantısını açın, verilen HTTPS adresini Safari veya Chrome'da ziyaret edin ve AgenticOS erişim anahtarıyla giriş yapın. Wi-Fi'yi kapatıp mobil veriyle tekrar deneyin.

Bilgisayarın açık ve internete bağlı olması gerekir. Erişimi kapatmak için `tailscale serve off` kullanın. Bir telefonu çıkarmak için cihazı özel ağdan kaldırın. Erişim anahtarını bağlantıya, ekran görüntüsüne veya QR koduna koymayın.

Tailscale kullanmak istemeyenler, kendi yönettikleri ücretsiz/açık kaynak WireGuard VPN ve HTTPS ters vekil sunucuyla aynı web arayüzüne ulaşabilir. Bu yolun ağ, DNS, sertifika ve bakım işleri kurana aittir. Depo mobil görünümü ve güvenlik kurallarını test edebilir; gerçek telefon bağlantısı kurulan ağda ayrıca denenmelidir.
