/* VP transport adapter. Presentation and interactions are provided by unmodified DOMjudge assets. */
(() => {
    'use strict';
    const send = (type, data = {}) => window.dispatchEvent(new CustomEvent('domjudge-vp-request', { detail: { type, ...data } }));
    let submissions = { submissions: {} };
    let board = '';
    let problemset = '';
    let selectedPage = 'scoreboard';
    let requestId = 0;
    window.scoreboardUrl = '/__domjudge_vp/scoreboard';
    window.initializeScoreboard = () => { initFavouriteTeams(); pinScoreheader(); initScoreboardSubmissions(); };
    const pending = new Map();
    const actualFetch = window.fetch.bind(window);
    window.fetch = (resource, options) => {
        const url = typeof resource === 'string' ? resource : resource.url;
        if (new URL(url, document.baseURI).pathname === '/__domjudge_vp/submissions') {
            return Promise.resolve(new Response(JSON.stringify(submissions), { headers: { 'Content-Type': 'application/json' } }));
        }
        return actualFetch(resource, options);
    };
    $.ajaxTransport('+*', options => {
        const url = new URL(options.url, document.baseURI);
        if (url.pathname === '/__domjudge_vp/scoreboard') {
            return { send(_, complete) { complete(200, 'OK', { text: board }); }, abort() {} };
        }
        const match = url.pathname.match(/^\/__domjudge_vp\/team\/(t[\da-f]+)$/);
        if (!match) return;
        let id;
        return {
            send(_, complete) {
                id = ++requestId;
                const timer = setTimeout(() => { pending.delete(id); complete(504, 'Team request timed out'); }, 15000);
                pending.set(id, result => { clearTimeout(timer); complete(result.error ? 500 : 200, result.error || 'OK', { text: result.html || '' }); });
                send('team', { requestId: id, teamId: match[1] });
            },
            abort() { const finish = pending.get(id); if (finish) { pending.delete(id); finish({ error: 'Aborted' }); } },
        };
    });
    function mount() {
        // Use the upstream refresh mechanism so open Bootstrap modals remain intact.
        if (document.querySelector('[data-ajax-refresh-target]')) {
            processAjaxResponse({ getResponseHeader: () => null }, board);
            const progress = $(board).filter('[data-progress-bar]').first();
            $('#vp-native-root > [data-progress-bar]').html(progress.children());
        } else {
            // jQuery executes the upstream template's own inline scripts on insertion.
            $('#vp-native-root').html(board);
            window.initializeScoreboard();
        }
        if (selectedPage === 'problemset' && problemset) $('[data-ajax-refresh-target]').html(problemset);
        document.querySelectorAll('a[href^="https:"],a[href^="http:"]').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
    }
    window.addEventListener('domjudge-vp-response', event => {
        const message = event.detail;
        if (message.type === 'snapshot') {
            board = message.html;
            submissions = message.submissions;
            problemset = '';
            mount();
            if (selectedPage === 'problemset') send('problems');
        } else if (message.type === 'team-result') {
            const complete = pending.get(message.requestId);
            pending.delete(message.requestId);
            complete?.(message);
        } else if (message.type === 'problems-result') {
            problemset = message.html;
            if (selectedPage === 'problemset') mount();
        }
    });
    document.addEventListener('submit', event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.closest('.filterbox') && !form.querySelector('.filterbox')) return;
        event.preventDefault();
        const clear = event.submitter?.name === 'clear';
        send('filter', { affiliations: clear ? [] : new FormData(form).getAll('affiliations[]') });
    });
    document.addEventListener('click', event => {
        const anchor = event.target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (href === '#scoreboard' || href === '#problemset') {
            event.preventDefault();
            selectedPage = href.slice(1);
            if (selectedPage === 'problemset' && !problemset) send('problems');
            else mount();
        }
    });
    initializeAjaxModals();
})();
