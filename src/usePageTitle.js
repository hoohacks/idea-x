import { useEffect } from 'react';
import { EVENT } from "./eventInfo";

export default function usePageTitle(title) {
    useEffect(() => {
        const prev = document.title;
        document.title = `${title} · ${EVENT.name}`;
        return () => {
            document.title = prev;
        };
    }, [title]);
}

