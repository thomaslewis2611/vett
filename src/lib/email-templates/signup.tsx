import * as React from "react";

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
} from "@react-email/components";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({ confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Activate your vett Buyer Pass</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={brand}>vett</Text>
        </Section>

        <Section style={card}>
          <Heading style={h1}>Activate your Buyer Pass</Heading>
          <Text style={text}>
            Thanks for purchasing a vett Buyer Pass. Click below to activate your account and get unlimited property
            analyses for 90 days, including flood risk data, AI chat, and more.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Activate my Buyer Pass →
          </Button>
          <Hr style={hr} />
          <Text style={small}>If the button doesn't work, copy and paste this link into your browser:</Text>
          <Link href={confirmationUrl} style={linkStyle}>
            {confirmationUrl}
          </Link>
          <Text style={smallMuted}>If you didn't request this, you can safely ignore this email.</Text>
        </Section>

        <Section style={footer}>
          <Text style={footerText}>© 2026 vett · vetthome.com · Every listing. Vetted. </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default SignupEmail;

const main = {
  backgroundColor: "#ffffff",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  margin: 0,
  padding: "32px 0",
};
const container = { maxWidth: "560px", margin: "0 auto", padding: "0 20px" };
const header = { padding: "0 0 24px" };
const brand = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: "24px",
  fontWeight: 700 as const,
  color: "#1A1108",
  letterSpacing: "-1px",
  margin: 0,
};
const card = {
  backgroundColor: "#FFFDF9",
  border: "1px solid rgba(26, 17, 8, 0.12)",
  borderRadius: "12px",
  padding: "32px",
};
const h1 = {
  fontSize: "24px",
  fontWeight: 700 as const,
  color: "#1A1108",
  margin: "0 0 12px",
  lineHeight: "1.3",
};
const text = {
  fontSize: "15px",
  color: "#1A1108",
  lineHeight: "1.6",
  margin: "0 0 24px",
};
const button = {
  backgroundColor: "#2D6A4F",
  color: "#FFFDF9",
  fontSize: "15px",
  fontWeight: 600 as const,
  borderRadius: "8px",
  padding: "14px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const hr = {
  border: "none",
  borderTop: "1px solid rgba(26, 17, 8, 0.12)",
  margin: "28px 0 20px",
};
const small = {
  fontSize: "13px",
  color: "#888780",
  lineHeight: "1.5",
  margin: "0 0 8px",
};
const linkStyle = {
  fontSize: "13px",
  color: "#2D6A4F",
  wordBreak: "break-all" as const,
};
const smallMuted = {
  fontSize: "13px",
  color: "#888780",
  lineHeight: "1.5",
  margin: "20px 0 0",
};
const footer = { padding: "24px 8px 0", textAlign: "center" as const };
const footerText = { fontSize: "12px", color: "#888780", margin: 0 };
