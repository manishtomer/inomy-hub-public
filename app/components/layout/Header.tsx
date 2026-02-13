'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ConnectButton } from '@/components/wallet';

const ADMIN_WALLET = '0x94AE63aD0A6aB42e1688CCe578D0DD8b4A2B24e2';

const navItems = [
  { href: '/story', label: 'Story' },
  { href: '/arena', label: 'Arena' },
  { href: '/agents', label: 'Agents' },
  { href: '/portfolio', label: 'Portfolio' },
];

export function Header() {
  const pathname = usePathname();
  const { user } = usePrivy();
  const isAdmin = user?.wallet?.address?.toLowerCase() === ADMIN_WALLET.toLowerCase();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-void/95 backdrop-blur-sm border-b border-neutral-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="text-cyber-500 font-mono text-sm">
              {'>'}_
            </div>
            <span className="text-base font-bold text-purple-400 uppercase tracking-widest">
              Inomy
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors
                    ${
                      isActive
                        ? 'text-cyber-500 bg-neutral-800/50'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }
                  `}
                >
                  {item.label}
                </Link>
              );
            })}
            {isAdmin && (
              <Link
                href="/admin"
                className={`
                  px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors
                  ${
                    pathname === '/admin' || pathname?.startsWith('/admin/')
                      ? 'text-amber-500 bg-neutral-800/50'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }
                `}
              >
                Admin
              </Link>
            )}
          </nav>

          {/* Right side: wallet + hamburger */}
          <div className="flex items-center gap-2">
            <ConnectButton />
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-neutral-800 bg-void/95 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 py-2 flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors rounded
                    ${
                      isActive
                        ? 'text-cyber-500 bg-neutral-800/50'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }
                  `}
                >
                  {item.label}
                </Link>
              );
            })}
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setMobileOpen(false)}
                className={`
                  px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors rounded
                  ${
                    pathname === '/admin' || pathname?.startsWith('/admin/')
                      ? 'text-amber-500 bg-neutral-800/50'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }
                `}
              >
                Admin
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
