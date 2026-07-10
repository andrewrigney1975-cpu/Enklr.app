using System.Security.Cryptography.X509Certificates;

namespace Enkl.Api.Auth;

/// <summary>
/// Parses the IdP signing certificate an OrgAdmin pastes into the SSO config form — accepted as
/// either a full PEM block or a bare base64 DER string, since different IdPs' admin consoles offer
/// one or the other when you download/copy their signing cert.
/// </summary>
public static class SamlCertificateHelper
{
    public static X509Certificate2 Parse(string raw)
    {
        var cleaned = raw
            .Replace("-----BEGIN CERTIFICATE-----", "")
            .Replace("-----END CERTIFICATE-----", "")
            .Replace("\r", "").Replace("\n", "").Trim();
        return X509CertificateLoader.LoadCertificate(Convert.FromBase64String(cleaned));
    }

    public static bool TryParse(string raw, out X509Certificate2? certificate)
    {
        try
        {
            certificate = Parse(raw);
            return true;
        }
        catch
        {
            certificate = null;
            return false;
        }
    }
}
