# MIDAD Android permanent signing

## Identity decision

- Existing installed app: `ai.midad.mobile`, version `0.4.1`. Preserve it; do not uninstall or overwrite it.
- The original CI signing key was ephemeral and deleted after its run. Its private key cannot be reconstructed from the APK.
- A new signing identity cannot update the installed v0.4.1 app. The permanent release product is therefore `midad-mobile-next`, package `ai.midad.mobile.next`, version `0.5.0`.
- This is a separate install, not an in-place upgrade. Do not migrate or delete user data automatically.

## GitHub Actions secrets

Create these repository Actions secrets in **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `MIDAD_ANDROID_KEYSTORE_BASE64` | Base64 encoding of the permanent JKS/PKCS12 keystore file; CI detects the stored type and passes it explicitly to `apksigner` |
| `MIDAD_ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `MIDAD_ANDROID_KEY_ALIAS` | Alias containing the release key |
| `MIDAD_ANDROID_KEY_PASSWORD` | Private-key password |

Generate the keystore once on a trusted device under the owner's control. Keep an offline encrypted backup. Never commit the keystore, passwords, or base64 payload to Git; never paste them into chat, issue comments, or workflow inputs. Do not reuse the temporary v0.4.1 key (it is unavailable).

## Build modes

- Pull requests, pushes, and manual `debug` runs use a fresh ephemeral key. Their APKs are installable test artifacts only and are not update-compatible across builds.
- Manual `release` runs require all four secrets, validate the keystore and alias, sign with the permanent key, verify the APK signature, and publish the signing mode in the artifact name.
- Permanent releases are restricted to `midad-mobile-next`. The workflow fails closed if another product is selected or any signing secret is absent.
- CI verifies that the APK installs and launches in the emulator. Before distributing a release, compare its signer SHA-256 fingerprint against the first approved permanent release and retain that fingerprint in the release record.

## First permanent release checklist

1. Add the four repository Actions secrets.
2. Run **MIDAD Mobile Android** manually with product `midad-mobile-next` and release mode `release`.
3. Confirm the run succeeds, record the signer SHA-256 fingerprint from the verification step, and retain the APK plus checksum.
4. Install v0.5.0 alongside v0.4.1 and verify the app opens. Do not uninstall v0.4.1 until the new app has been accepted.
5. For every later release, reuse the same permanent keystore. Rotating it creates another incompatible signing identity.

## Recovery

If the permanent keystore is lost, Android updates signed with that identity cannot be produced. Keep at least two encrypted backups under owner control and test recovery before production distribution.
