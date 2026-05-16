import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Roovr access link</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={brand}>Roovr</Text>
        </Section>

        <Section style={card}>
          <Heading style={h1}>Your access link is ready</Heading>
          <Text style={text}>
            Click the button below to access your Roovr report. This link is
            unique to you and expires in 24 hours.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Access my Roovr report →
          </Button>
          <Hr style={hr} />
          <Text style={small}>
            If the button doesn't work, copy and paste this link into your
            browser:
          </Text>
          <Link href={confirmationUrl} style={linkStyle}>
            {confirmationUrl}
          </Link>
          <Text style={smallMuted}>
            If you didn't request this link, you can safely ignore this email.
          </Text>
        </Section>

        <Section style={footer}>
          <Text style={footerText}>
            © 2026 Roovr · roovr.co · Every listing. Analysed. Instantly.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  margin: 0,
  padding: '32px 0',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 20px' }
const header = { padding: '0 0 24px' }
const brand = {
  fontSize: '20px',
  fontWeight: 700 as const,
  color: '#2D6A4F',
  letterSpacing: '-0.01em',
  margin: 0,
}
const card = {
  backgroundColor: '#FFFDF9',
  border: '1px solid rgba(26, 17, 8, 0.12)',
  borderRadius: '12px',
  padding: '32px',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 700 as const,
  color: '#1A1108',
  margin: '0 0 12px',
  lineHeight: '1.3',
}
const text = {
  fontSize: '15px',
  color: '#1A1108',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const button = {
  backgroundColor: '#2D6A4F',
  color: '#FFFDF9',
  fontSize: '15px',
  fontWeight: 600 as const,
  borderRadius: '8px',
  padding: '14px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = {
  border: 'none',
  borderTop: '1px solid rgba(26, 17, 8, 0.12)',
  margin: '28px 0 20px',
}
const small = {
  fontSize: '13px',
  color: '#888780',
  lineHeight: '1.5',
  margin: '0 0 8px',
}
const linkStyle = {
  fontSize: '13px',
  color: '#2D6A4F',
  wordBreak: 'break-all' as const,
}
const smallMuted = {
  fontSize: '13px',
  color: '#888780',
  lineHeight: '1.5',
  margin: '20px 0 0',
}
const footer = { padding: '24px 8px 0', textAlign: 'center' as const }
const footerText = { fontSize: '12px', color: '#888780', margin: 0 }
