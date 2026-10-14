import { createContext, useCallback, useEffect, useState } from 'react'
import TopBar from './components/TopBar'
import Rail from './components/Rail'
import HomePage from './pages/HomePage'
import BookPage from './pages/BookPage'
import WizardPage from './pages/WizardPage'
import BankPage from './pages/BankPage'
import QuizPage from './pages/QuizPage'
import ReportPage from './pages/ReportPage'
import QAPage from './pages/QAPage'
import ModelsPage from './pages/ModelsPage'
import TasksPage from './pages/TasksPage'
import SettingsPage from './pages/SettingsPage'
import WrongPage from './pages/WrongPage'

export type View =
  | 'home' | 'book' | 'wizard' | 'bank' | 'quiz' | 'report'
  | 'qa' | 'models' | 'tasks' | 'settings' | 'wrong'

interface ToastMsg {
  id: number
  text: string
}

export const ToastContext = createContext<(text: string) => void>(() => {})

export default function App() {
  const [view, setView] = useState<View>('home')
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('lumen-theme') as 'light' | 'dark') || 'light'
  )
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('lumen-theme', theme)
  }, [theme])

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const pages: Record<View, React.ReactNode> = {
    home: <HomePage go={setView} />,
    book: <BookPage go={setView} />,
    wizard: <WizardPage go={setView} />,
    bank: <BankPage go={setView} />,
    quiz: <QuizPage go={setView} />,
    report: <ReportPage go={setView} />,
    qa: <QAPage />,
    models: <ModelsPage />,
    tasks: <TasksPage />,
    settings: <SettingsPage />,
    wrong: <WrongPage />,
  }

  return (
    <ToastContext.Provider value={toast}>
      <TopBar theme={theme} onToggleTheme={toggleTheme} />
      <div className="app">
        <Rail view={view} onNavigate={setView} />
        <main className="main" key={view}>
          {pages[view]}
        </main>
      </div>
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast-item">{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
