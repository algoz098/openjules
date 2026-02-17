import { createHmac, timingSafeEqual } from 'crypto'

export const safeCompareSignatures = (received: string, expected: string) => {
  const receivedBuffer = Buffer.from(received || '', 'utf8')
  const expectedBuffer = Buffer.from(expected || '', 'utf8')
  if (receivedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(receivedBuffer, expectedBuffer)
}

export const computeWebhookSignatureResult = (input: {
  secret?: string
  payloadBody: string
  signature256: string
  signatureLegacy: string
}) => {
  if (!input.secret) {
    return {
      valid: true,
      scheme: 'none' as const
    }
  }

  const expected256 = `sha256=${createHmac('sha256', input.secret).update(input.payloadBody).digest('hex')}`
  const expectedLegacy = `sha1=${createHmac('sha1', input.secret).update(input.payloadBody).digest('hex')}`

  const isValid256 = input.signature256 ? safeCompareSignatures(input.signature256, expected256) : false
  const isValidLegacy = input.signatureLegacy ? safeCompareSignatures(input.signatureLegacy, expectedLegacy) : false

  if (!isValid256 && !isValidLegacy) {
    return {
      valid: false,
      scheme: 'none' as const
    }
  }

  return {
    valid: true,
    scheme: (isValid256 ? 'sha256' : 'sha1') as 'sha256' | 'sha1'
  }
}
