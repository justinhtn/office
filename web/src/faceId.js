import { api } from './api.js'

// The sign-in page in server/server.py does the same, for a device that's just entered its code.
const toText = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const toBytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), letter => letter.charCodeAt(0))

// Whether this device, signed in over Tailscale, can still add Face ID. The Mac's own port has no such thing.
export async function canSetUpFaceId() {
  try {
    if (!window.PublicKeyCredential || !await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) return false

    return (await api('/api/passkey/status')).canSetUp === true
  } catch {
    return false
  }
}

// Asked for before the tap, because Safari may refuse Face ID if the tap waits on the network first.
export const faceIdOptions = () => api('/api/passkey/register-options', {})

export async function setUpFaceId(options) {
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: toBytes(options.challenge),
    rp: { id: options.rpId, name: 'Agent Office' },
    user: { id: toBytes(options.userId), name: options.name, displayName: options.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    attestation: 'none',
    timeout: 120000,
  } })

  await api('/api/passkey/register', { id: credential.id, clientDataJSON: toText(credential.response.clientDataJSON), attestationObject: toText(credential.response.attestationObject) })
}

// Approving a card: this device's own passkey, with Face ID, answering a challenge tied to that card. Options come before the tap, as above.
export const approvalOptions = id => api('/api/approvals/options', { id })

export async function approveWithFaceId(id, options) {
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: toBytes(options.challenge),
    rpId: options.rpId,
    allowCredentials: [{ type: 'public-key', id: toBytes(options.credential) }],
    userVerification: 'required',
    timeout: 120000,
  } })

  return api('/api/approvals/approve', { id, answer: {
    id: credential.id,
    clientDataJSON: toText(credential.response.clientDataJSON),
    authenticatorData: toText(credential.response.authenticatorData),
    signature: toText(credential.response.signature),
  } })
}
