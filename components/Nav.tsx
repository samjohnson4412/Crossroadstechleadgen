'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Upload, BarChart2, Database } from 'lucide-react'

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/data', label: 'Data Sources', icon: Database },
  { href: '/stats', label: 'Stats', icon: BarChart2 },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <nav style={{ background: 'var(--navy)' }} className="shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: 'var(--cyan)' }}>CT</div>
            <div>
              <div className="text-white font-bold text-sm leading-tight">CROSSROADS</div>
              <div className="text-xs leading-tight" style={{ color: 'var(--cyan)' }}>TECHNOLOGY</div>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname === href
              return (
                <Link key={href} href={href}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{ background: active ? 'var(--cyan)' : 'transparent', color: active ? 'var(--navy)' : 'rgba(255,255,255,0.8)' }}>
                  <Icon size={15} />{label}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
