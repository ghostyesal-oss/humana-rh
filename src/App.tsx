import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import './App.css'
import { documents, employees, jobs, leaveRequests, reviews } from './data'
import { isSupabaseConfigured, supabase } from './supabase'

type Page = 'dashboard' | 'employees' | 'leave' | 'documents' | 'recruitment' | 'reviews'

const navigation: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'employees', label: 'Collaborateurs', icon: Users },
  { id: 'leave', label: 'Congés & absences', icon: CalendarDays },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'recruitment', label: 'Recrutement', icon: BriefcaseBusiness },
  { id: 'reviews', label: 'Évaluations', icon: ClipboardCheck },
]

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: 'Bonjour Sophie 👋', subtitle: 'Voici ce qui se passe dans votre entreprise aujourd’hui.' },
  employees: { title: 'Collaborateurs', subtitle: 'Gérez les profils, les équipes et les informations RH.' },
  leave: { title: 'Congés & absences', subtitle: 'Suivez les demandes et les soldes de congés.' },
  documents: { title: 'Documents', subtitle: 'Centralisez et partagez les documents de l’entreprise.' },
  recruitment: { title: 'Recrutement', subtitle: 'Pilotez vos offres et votre vivier de candidats.' },
  reviews: { title: 'Évaluations', subtitle: 'Préparez et suivez les campagnes d’entretien.' },
}

function MicrosoftLogo() {
  return (
    <span className="microsoft-logo" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  )
}

function Login({ onDemo }: { onDemo: () => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn() {
    if (!supabase) return
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: window.location.origin,
        scopes: 'email',
      },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand brand-large"><span>H</span> Humana</div>
        <div className="login-message">
          <span className="eyebrow">L’espace RH qui rassemble</span>
          <h1>Votre équipe.<br /><em>Simplement.</em></h1>
          <p>Une expérience fluide pour accompagner vos collaborateurs, du premier jour à chaque nouvelle étape.</p>
          <div className="trust-row">
            <span><Check size={16} /> Données sécurisées</span>
            <span><Check size={16} /> Conforme RGPD</span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand brand"><span>H</span> Humana</div>
          <div className="login-icon"><ShieldCheck size={26} /></div>
          <h2>Bienvenue</h2>
          <p>Connectez-vous avec votre compte professionnel pour accéder à votre espace RH.</p>
          <button className="microsoft-button" onClick={signIn} disabled={!isSupabaseConfigured || loading}>
            <MicrosoftLogo />
            {loading ? 'Redirection…' : 'Continuer avec Microsoft'}
          </button>
          {!isSupabaseConfigured && (
            <div className="config-note">
              Ajoutez les variables Supabase dans <code>.env.local</code> pour activer la connexion.
            </div>
          )}
          {error && <p className="error-message">{error}</p>}
          <div className="separator"><span>ou</span></div>
          <button className="demo-button" onClick={onDemo}>Voir l’aperçu de démonstration</button>
          <small>En continuant, vous acceptez les conditions d’utilisation et la politique de confidentialité.</small>
        </div>
      </section>
    </main>
  )
}

function StatusBadge({ children }: { children: ReactNode }) {
  const value = String(children).toLowerCase()
  const tone = value.includes('actif') || value.includes('approuv') || value.includes('termin')
    ? 'success'
    : value.includes('valid') || value.includes('cours') || value.includes('compléter')
      ? 'warning'
      : 'neutral'
  return <span className={`badge ${tone}`}>{children}</span>
}

function Dashboard() {
  return (
    <>
      <section className="stats-grid">
        <StatCard icon={Users} label="Collaborateurs" value="48" detail="+3 ce mois" tone="purple" />
        <StatCard icon={CalendarDays} label="Absents aujourd’hui" value="4" detail="Voir le planning" tone="orange" />
        <StatCard icon={BriefcaseBusiness} label="Postes ouverts" value="3" detail="25 candidats" tone="blue" />
        <StatCard icon={ClipboardCheck} label="Entretiens à faire" value="7" detail="Avant le 31 août" tone="green" />
      </section>
      <section className="dashboard-grid">
        <div className="card">
          <CardHeading title="Demandes à valider" action="Tout voir" />
          <div className="request-list">
            {leaveRequests.slice(1).map((request) => (
              <div className="request-item" key={request.employee}>
                <Avatar initials={request.initials} />
                <div><strong>{request.employee}</strong><span>{request.type} · {request.dates}</span></div>
                <div className="quick-actions"><button aria-label="Refuser"><X size={16} /></button><button className="approve" aria-label="Approuver"><Check size={16} /></button></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <CardHeading title="Équipe en un coup d’œil" action="Organigramme" />
          <div className="team-chart">
            <div className="donut"><div><strong>48</strong><span>personnes</span></div></div>
            <div className="legend">
              <span><i className="dot purple" /> Produit & Tech <b>18</b></span>
              <span><i className="dot blue" /> Ventes <b>12</b></span>
              <span><i className="dot orange" /> Opérations <b>10</b></span>
              <span><i className="dot green" /> Autres <b>8</b></span>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function StatCard({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={21} /></div><span>{label}</span><strong>{value}</strong><small>{detail} <TrendingUp size={13} /></small></div>
}

function CardHeading({ title, action }: { title: string; action: string }) {
  return <div className="card-heading"><h3>{title}</h3><button>{action} <ChevronRight size={15} /></button></div>
}

function Avatar({ initials, color = 'violet' }: { initials: string; color?: string }) {
  return <span className={`avatar ${color}`}>{initials}</span>
}

function EmployeesPage() {
  return (
    <div className="card table-card">
      <div className="toolbar"><div className="search-box"><Search size={17} /><input aria-label="Rechercher" placeholder="Rechercher un collaborateur…" /></div><button className="primary"><Plus size={17} /> Ajouter</button></div>
      <div className="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Équipe</th><th>Statut</th><th /></tr></thead><tbody>
        {employees.map((employee) => <tr key={employee.name}><td><div className="person"><Avatar initials={employee.initials} color={employee.color} /><div><strong>{employee.name}</strong><span>{employee.role}</span></div></div></td><td>{employee.team}</td><td><StatusBadge>{employee.status}</StatusBadge></td><td><button className="icon-button"><MoreHorizontal size={18} /></button></td></tr>)}
      </tbody></table></div>
    </div>
  )
}

function LeavePage() {
  return (
    <div className="card table-card">
      <div className="toolbar"><div className="tabs"><button className="active">Demandes</button><button>Calendrier</button><button>Soldes</button></div><button className="primary"><Plus size={17} /> Nouvelle demande</button></div>
      <div className="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Type</th><th>Dates</th><th>Durée</th><th>Statut</th></tr></thead><tbody>
        {leaveRequests.map((request) => <tr key={request.employee}><td><div className="person"><Avatar initials={request.initials} /><strong>{request.employee}</strong></div></td><td>{request.type}</td><td>{request.dates}</td><td>{request.duration}</td><td><StatusBadge>{request.status}</StatusBadge></td></tr>)}
      </tbody></table></div>
    </div>
  )
}

function DocumentsPage() {
  return <section className="document-grid">{documents.map((document) => <article className="document-card" key={document.title}><div className="file-icon"><FileText size={23} /></div><div><strong>{document.title}</strong><span>{document.category}</span><small>Mis à jour le {document.updated}</small></div><span className="file-type">{document.type}</span></article>)}</section>
}

function RecruitmentPage() {
  return <section className="jobs-grid">{jobs.map((job) => <article className="card job-card" key={job.title}><div className={`job-icon ${job.color}`}><BriefcaseBusiness size={20} /></div><StatusBadge>{job.stage}</StatusBadge><h3>{job.title}</h3><p>{job.department}</p><div className="candidate-count"><CircleUserRound size={17} /><strong>{job.candidates}</strong> candidats</div><button className="outline-button">Voir le poste <ChevronRight size={15} /></button></article>)}</section>
}

function ReviewsPage() {
  return <div className="card reviews-card"><CardHeading title="Campagne d’entretiens · S1 2026" action="Configurer" />{reviews.map((review) => <div className="review-row" key={review.employee}><div><strong>{review.employee}</strong><span>{review.period}</span></div><div className="progress"><i style={{ width: `${review.progress}%` }} /></div><b>{review.progress}%</b><StatusBadge>{review.status}</StatusBadge><strong>{review.score}</strong></div>)}</div>
}

function PageContent({ page }: { page: Page }) {
  if (page === 'dashboard') return <Dashboard />
  if (page === 'employees') return <EmployeesPage />
  if (page === 'leave') return <LeavePage />
  if (page === 'documents') return <DocumentsPage />
  if (page === 'recruitment') return <RecruitmentPage />
  return <ReviewsPage />
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [demo, setDemo] = useState(false)
  const [page, setPage] = useState<Page>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      return
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="loading-screen">Chargement…</div>
  if (!session && !demo) return <Login onDemo={() => setDemo(true)} />

  const metadata = session?.user.user_metadata
  const displayName = metadata?.full_name || metadata?.name || 'Sophie Martin'
  const email = session?.user.email || 'sophie@entreprise.fr'

  async function signOut() {
    if (session && supabase) await supabase.auth.signOut()
    setDemo(false)
  }

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><span>H</span> Humana</div>
        <button className="close-menu" onClick={() => setSidebarOpen(false)}><X /></button>
        <nav>
          <p>ESPACE RH</p>
          {navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setSidebarOpen(false) }}><Icon size={19} />{label}{id === 'leave' && <i>2</i>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button><Settings size={19} /> Paramètres</button>
          <div className="user-card"><Avatar initials={displayName.split(' ').map((part: string) => part[0]).slice(0, 2).join('')} /><div><strong>{displayName}</strong><span>{email}</span></div><button onClick={signOut} aria-label="Se déconnecter"><LogOut size={17} /></button></div>
        </div>
      </aside>
      {sidebarOpen && <button className="backdrop" onClick={() => setSidebarOpen(false)} aria-label="Fermer le menu" />}
      <main className="main-content">
        <header className="topbar"><button className="menu-button" onClick={() => setSidebarOpen(true)}><Menu /></button><div className="top-search"><Search size={17} /><span>Rechercher…</span><kbd>⌘ K</kbd></div><button className="notification"><Bell size={19} /><i /></button><button className="primary compact"><Plus size={17} /> Action rapide</button></header>
        <div className="page">
          <div className="page-heading"><div><h1>{pageTitles[page].title}</h1><p>{pageTitles[page].subtitle}</p></div>{demo && <span className="demo-pill">Mode démo</span>}</div>
          <PageContent page={page} />
        </div>
      </main>
    </div>
  )
}

export default App
