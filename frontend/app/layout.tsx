import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { QueryProvider } from '@/components/providers/query-provider'
import { GoogleProvider } from '@/components/providers/google-provider'
import { RealtimeNotifications } from '@/components/providers/realtime-notifications'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'EventNexus — AI-Enabled Secure Event Management',
  description:
    'EventNexus brings AI intelligence, secure cloud infrastructure, and real-time collaboration to every event — from small workshops to global multi-organization conferences.',
}

export const viewport = {
  themeColor: '#5b4cf5',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      // next-themes injects `style="color-scheme:..."` on <html> client-side
      // before React hydrates (its pre-hydration script), which the server
      // HTML doesn't include — suppress the resulting attribute diff.
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <GoogleProvider>
          <QueryProvider>
            <ThemeProvider attribute="class" defaultTheme="light">
              {children}
              <RealtimeNotifications />
              <Toaster position="bottom-right" closeButton richColors />
            </ThemeProvider>
          </QueryProvider>
        </GoogleProvider>
      </body>
    </html>
  )
}