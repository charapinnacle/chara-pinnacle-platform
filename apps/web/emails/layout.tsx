import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function Layout({ preview, heading, children }: { preview: string; heading: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f4f4f5", fontFamily: font, margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 8, maxWidth: 560, padding: "32px 28px" }}>
          <Text style={{ color: "#52525b", fontSize: 13, fontWeight: 600, letterSpacing: 1, margin: "0 0 16px" }}>CHARA</Text>
          <Heading as="h1" style={{ color: "#18181b", fontSize: 22, lineHeight: "28px", margin: "0 0 16px" }}>
            {heading}
          </Heading>
          {children}
          <Hr style={{ borderColor: "#e4e4e7", margin: "28px 0 16px" }} />
          <Text style={{ color: "#71717a", fontSize: 12, lineHeight: "18px", margin: 0 }}>
            This is a service email about your CHARA account. Open the link to see the details.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={{ color: "#27272a", fontSize: 15, lineHeight: "22px", margin: "0 0 14px" }}>{children}</Text>;
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <Section style={{ borderLeft: "3px solid #d4d4d8", margin: "0 0 14px", padding: "0 0 0 12px" }}>
      <Text style={{ color: "#3f3f46", fontSize: 15, lineHeight: "22px", margin: 0 }}>{children}</Text>
    </Section>
  );
}

export function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      href={href}
      style={{ backgroundColor: "#18181b", borderRadius: 6, color: "#ffffff", fontSize: 14, fontWeight: 600, padding: "10px 18px" }}
    >
      {children}
    </Button>
  );
}
