'use client'

import { useState, useEffect } from "react"
import { Bug, X, LayoutDashboard, RotateCcw } from "lucide-react"
import { useRouter } from "next/navigation"

// Only render in development
const IS_DEV = process.env.NODE_ENV === 'development'

export default function DevPanel() {
    const [isMinimized, setIsMinimized] = useState(true)
    const router = useRouter()

    // Don't render anything in production
    if (!IS_DEV) {
        return null
    }

    // Keyboard shortcut: Ctrl+Shift+D to toggle panel
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault()
                setIsMinimized(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    if (isMinimized) {
        return (
            <button
                onClick={() => setIsMinimized(false)}
                className="fixed bottom-4 right-4 z-[9999] bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110"
                title="Dev Panel (Ctrl+Shift+D)"
            >
                <Bug className="w-5 h-5" />
            </button>
        )
    }

    return (
        <div className="fixed bottom-4 right-4 z-[9999] w-72 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-orange-500/50">
            <div className="flex items-center justify-between p-3 border-b border-orange-500/30 bg-orange-500/10">
                <div className="flex items-center gap-2">
                    <Bug className="w-4 h-4 text-orange-500" />
                    <span className="font-semibold text-sm">Dev Panel</span>
                    <span className="text-[10px] px-1.5 py-0.5 border border-orange-500/50 text-orange-500 rounded font-medium">
                        ADMIN
                    </span>
                </div>
                <button onClick={() => setIsMinimized(true)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-3 space-y-2">
                <p className="text-xs text-gray-500">
                    Quick nav. <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Ctrl+Shift+D</kbd>
                </p>

                <button
                    onClick={() => router.push('/admin')}
                    className="w-full flex items-center gap-2 p-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
                >
                    <LayoutDashboard className="w-4 h-4 text-orange-500" />
                    Dashboard
                </button>

                <button
                    onClick={() => {
                        localStorage.clear()
                        sessionStorage.clear()
                        window.location.reload()
                    }}
                    className="w-full flex items-center gap-2 p-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
                >
                    <RotateCcw className="w-4 h-4" />
                    Clear All & Reload
                </button>
            </div>
        </div>
    )
}
