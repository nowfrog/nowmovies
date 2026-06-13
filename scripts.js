document.addEventListener('DOMContentLoaded', () => {
    // Elementi DOM
    const navContainer = document.getElementById('movie-lists-nav');
    const filterControls = document.getElementById('filter-controls');
    const moviesContainer = document.getElementById('movies-container');
    const searchBar = document.getElementById('search-bar');
    const sortSelect = document.getElementById('sort-select');
    const scrollTopButton = document.getElementById('scroll-top');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const welcomeMessage = document.getElementById('welcome-message');
    const h1Title = document.getElementById('app-title');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessage = document.getElementById('error-message');
    const viewToggleButton = document.getElementById('view-toggle-button');
    const listDescription = document.getElementById('list-description');

    // Elementi Modale
    const modal = document.getElementById('movie-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalCloseButton = document.getElementById('modal-close-button');
    const modalPoster = document.getElementById('modal-poster');
    const modalTitle = document.getElementById('modal-title');
    const modalMeta = document.getElementById('modal-meta');
    const modalOverview = document.getElementById('modal-overview');
    const modalRating = document.getElementById('modal-rating');
    const modalImdbButton = document.getElementById('modal-imdb-button');
    const modalScreenshots = document.getElementById('modal-screenshots');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.getElementById('lightbox-close');

    // Elementi Admin
    const adminToggle = document.getElementById('admin-toggle');
    const adminPopup = document.getElementById('admin-popup');
    const adminPopupLogin = document.getElementById('admin-popup-login');
    const adminPopupLogout = document.getElementById('admin-popup-logout');
    const adminManageBar = document.getElementById('admin-manage-bar');
    const adminManageToggle = document.getElementById('admin-manage-toggle');
    const adminPanel = document.getElementById('admin-panel');
    const adminPasswordInput = document.getElementById('admin-password');
    const adminLoginBtn = document.getElementById('admin-login-btn');
    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    const adminListSelect = document.getElementById('admin-list-select');
    const adminAction = document.getElementById('admin-action');
    const adminSubmitBtn = document.getElementById('admin-submit-btn');
    const adminResponse = document.getElementById('admin-response');
    const adminDescriptionInput = document.getElementById('admin-description');
    const adminSaveDescriptionBtn = document.getElementById('admin-save-description-btn');

    // Stato dell'applicazione
    let allMoviesData = {};
    let currentMovies = [];
    let currentListName = null;
    let currentSortCriteria = '';
    let currentSearchTerm = '';
    let currentViewMode = 'cards';
    let crossListMap = {}; // movie_id -> [list_slugs]
    let manifestData = []; // Array di oggetti {slug, description}
    let adminPassword = '';
    let adminSearchTimeout = null;

    // --- Funzioni Helper ---

    const showLoading = (show) => {
        loadingIndicator.classList.toggle('hidden', !show);
    };

    const showError = (message) => {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        moviesContainer.innerHTML = '';
    };

    const hideError = () => {
        errorMessage.classList.add('hidden');
        errorMessage.textContent = '';
    };

    const loadCrossListMap = async () => {
        try {
            const formData = new FormData();
            formData.append('action', 'get_cross_list_map');
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status === 'ok') {
                crossListMap = data.map;
            } else {
            }
        } catch (err) {
        }
    };

    const getListTagsForMovie = (movieId) => {
        const lists = crossListMap[String(movieId)] || [];
        return lists.filter(slug => slug !== currentListName);
    };

    const humanizeSlug = (slug) => {
        return slug.replace(/[_\-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    };

    const fetchWithTimeout = (url, options = {}, timeout = 8000) => {
        const mergedOptions = { cache: 'no-store', ...options };
        return Promise.race([
            fetch(url, mergedOptions),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timed out')), timeout)
            )
        ]);
    };

    const getDescriptionForList = (slug) => {
        const entry = manifestData.find(e => e.slug === slug);
        return entry ? entry.description || '' : '';
    };

    const getColorForList = (slug) => {
        const entry = manifestData.find(e => e.slug === slug);
        return entry ? entry.color || '#8e8e93' : '#8e8e93';
    };

    // --- Caricamento Liste e Film ---

    const loadMovieList = async (listName, buttonElement) => {
        showLoading(true);
        hideError();
        closeModal();
        moviesContainer.innerHTML = '';
        currentListName = listName;
        currentSearchTerm = '';
        searchBar.value = '';
        currentSortCriteria = '';
        sortSelect.value = '';

        const savedViewMode = localStorage.getItem('viewMode') || 'cards';
        setViewMode(savedViewMode);

        // Mostra descrizione lista
        const desc = getDescriptionForList(listName);
        if (desc) {
            listDescription.textContent = desc;
            listDescription.classList.remove('hidden');
        } else {
            listDescription.classList.add('hidden');
        }

        try {
            if (!allMoviesData[listName]) {
                const response = await fetchWithTimeout(`liste/${listName}.json`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                 allMoviesData[listName] = Object.values(data).map(movie => ({
                    ...movie,
                    'your-rating-numeric': parseRating(movie['your-rating']),
                    'release-date-object': isValidDate(movie.release_date) ? new Date(movie.release_date) : new Date(0)
                }));
            }

            currentMovies = [...allMoviesData[listName]];
            applyFiltersAndSort();
            filterControls.classList.remove('hidden');
            welcomeMessage.style.display = 'none';
            highlightButton(buttonElement);
            h1Title.classList.remove('selected');

        } catch (error) {
            console.error('Error loading movie list:', error);
            showError(`Impossibile caricare la lista "${listName}". ${error.message}`);
            filterControls.classList.add('hidden');
            currentListName = null;
            deselectAllNavButtons();
        } finally {
            showLoading(false);
        }
    };

    // --- Funzioni di Rendering ---

    const displayMovies = (movies) => {
        moviesContainer.innerHTML = '';
        if (movies.length === 0 && currentListName) {
            moviesContainer.innerHTML = '<p class="no-results">No movies found.</p>';
            return;
        }
        movies.forEach(movie => {
            moviesContainer.appendChild(createMovieCard(movie));
        });
    };

     const createMovieCard = (movie) => {
        const movieCard = document.createElement('article');
        movieCard.className = 'movie-card';
        movieCard.dataset.movieId = movie.id;

        const posterContainer = document.createElement('div');
        posterContainer.className = 'movie-card__poster-container';

        const poster = document.createElement('img');
        poster.src = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'placeholder.png';
        poster.alt = `Poster per ${movie.original_title}`;
        poster.loading = 'lazy';

        posterContainer.appendChild(poster);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'movie-card__content';

        const title = document.createElement('h2');
        title.className = 'movie-card__title';
        title.textContent = movie.original_title || 'Titolo non disponibile';

        const releaseInfo = document.createElement('p');
        releaseInfo.className = 'movie-card__meta';
        const year = movie.release_date ? movie.release_date.substring(0, 4) : 'N/A';
        const runtime = movie.runtime ? `${movie.runtime} min.` : 'N/A';
        const directorNames = (movie.directors || []).map(d => d.name).join(', ');
        releaseInfo.textContent = `${year} · ${runtime}${directorNames ? ' · ' + directorNames : ''}`;

        let addedDateEl = null;
        if (movie.added_date) {
            addedDateEl = document.createElement('p');
            addedDateEl.className = 'movie-card__added-date';
            addedDateEl.textContent = `Added ${formatDate(movie.added_date)}`;
        }

        const overview = document.createElement('p');
        overview.className = 'movie-card__overview';
        overview.textContent = movie.overview || 'No overview available.';

        const footerDiv = document.createElement('div');
        footerDiv.className = 'movie-card__footer';

        const imdbButton = document.createElement('a');
        imdbButton.className = 'imdb-button';
        if (movie.imdb_id) {
            imdbButton.href = `https://www.imdb.com/title/${movie.imdb_id}`;
            imdbButton.target = '_blank';
            imdbButton.rel = 'noopener noreferrer';
            imdbButton.textContent = 'IMDb';
             imdbButton.addEventListener('click', (e) => e.stopPropagation());
        } else {
            imdbButton.textContent = 'IMDb N/A';
            imdbButton.style.opacity = '0.5';
            imdbButton.style.cursor = 'default';
            imdbButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }

        const rating = document.createElement('span');
        rating.className = 'movie-card__rating';
        const ratingValue = movie['your-rating'];
        const numericRating = movie['your-rating-numeric'];

        rating.textContent = ratingValue && ratingValue !== '-' ? ratingValue : '?';

        if (numericRating !== null && !isNaN(numericRating)) {
            if (numericRating >= 7) rating.classList.add('movie-card__rating--green');
            else if (numericRating >= 5) rating.classList.add('movie-card__rating--yellow');
            else rating.classList.add('movie-card__rating--red');
        } else {
             rating.classList.add('movie-card__rating--unknown');
        }

        footerDiv.appendChild(imdbButton);
        footerDiv.appendChild(rating);

        // List tags
        const otherLists = getListTagsForMovie(movie.id);
        let tagsDiv = null;
        if (otherLists.length > 0) {
            tagsDiv = document.createElement('div');
            tagsDiv.className = 'movie-card__tags';
            otherLists.forEach(slug => {
                const tag = document.createElement('span');
                tag.className = 'movie-card__tag';
                tag.textContent = humanizeSlug(slug);
                const color = getColorForList(slug);
                tag.style.backgroundColor = color;
                tag.style.color = '#fff';
                tagsDiv.appendChild(tag);
            });
        }

        contentDiv.appendChild(title);
        contentDiv.appendChild(releaseInfo);
        if (addedDateEl) contentDiv.appendChild(addedDateEl);
        if (tagsDiv) contentDiv.appendChild(tagsDiv);
        contentDiv.appendChild(overview);
        contentDiv.appendChild(footerDiv);

        movieCard.appendChild(posterContainer);
        movieCard.appendChild(contentDiv);

        movieCard.addEventListener('click', () => {
             const sourceMovies = allMoviesData[currentListName] || [];
             const movieData = sourceMovies.find(m => m.id.toString() === movieCard.dataset.movieId);
             if (movieData) {
                 openModal(movieData);
             } else {
                 console.error("Dati film non trovati per l'ID:", movieCard.dataset.movieId);
                 showError("Impossibile caricare i dettagli del film.");
             }
         });

        return movieCard;
    };

    const parseRating = (ratingStr) => {
        if (ratingStr === null || ratingStr === undefined || ratingStr === '-' || String(ratingStr).trim() === '') {
            return null;
        }
        const rating = parseFloat(String(ratingStr).replace(',', '.'));
        return isNaN(rating) ? null : rating;
    };

     const isValidDate = (dateString) => {
        if (!dateString) return false;
        const date = new Date(dateString);
        return date instanceof Date && !isNaN(date);
     }

    // --- Gestione Modale ---

    const openModal = (movieData) => {
        modalPoster.src = movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'placeholder.png';
        modalPoster.alt = `Poster per ${movieData.original_title}`;
        modalTitle.textContent = movieData.original_title || 'Titolo non disponibile';

        const year = movieData.release_date ? movieData.release_date.substring(0, 4) : 'N/A';
        const runtime = movieData.runtime ? `${movieData.runtime} min.` : 'N/A';
        const modalDirs = (movieData.directors || []).map(d => d.name).join(', ');
        const addedStr = movieData.added_date ? ` · Added ${formatDate(movieData.added_date)}` : '';
        modalMeta.textContent = `${year} · ${runtime}${modalDirs ? ' · Dir. ' + modalDirs : ''}${addedStr}`;

        // Modal tags
        const modalTagsDiv = document.getElementById('modal-tags');
        modalTagsDiv.innerHTML = '';
        const modalOtherLists = getListTagsForMovie(movieData.id);
        if (modalOtherLists.length > 0) {
            modalOtherLists.forEach(slug => {
                const tag = document.createElement('span');
                tag.className = 'movie-card__tag';
                tag.textContent = humanizeSlug(slug);
                const color = getColorForList(slug);
                tag.style.backgroundColor = color;
                tag.style.color = '#fff';
                modalTagsDiv.appendChild(tag);
            });
        }

        modalOverview.textContent = movieData.overview || 'No overview available.';

        modalRating.className = 'movie-card__rating modal-rating';
        const ratingValue = movieData['your-rating'];
        const numericRating = movieData['your-rating-numeric'];

        const ratingDisplay = ratingValue && ratingValue !== '-' ? ratingValue : '?';
        const ratingValEl = modalRating.querySelector('.modal-rating-value');
        if (ratingValEl) ratingValEl.textContent = ratingDisplay;
        else modalRating.textContent = ratingDisplay;

        if (numericRating !== null && !isNaN(numericRating)) {
             if (numericRating >= 7) modalRating.classList.add('movie-card__rating--green');
             else if (numericRating >= 5) modalRating.classList.add('movie-card__rating--yellow');
             else modalRating.classList.add('movie-card__rating--red');
        } else {
            modalRating.classList.add('movie-card__rating--unknown');
        }

        if (movieData.imdb_id) {
            modalImdbButton.href = `https://www.imdb.com/title/${movieData.imdb_id}`;
            modalImdbButton.style.display = 'inline-block';
        } else {
            modalImdbButton.href = '#';
            modalImdbButton.style.display = 'none';
        }

        // Cast
        const modalCast = document.getElementById('modal-cast');
        modalCast.innerHTML = '';
        if (movieData.cast && movieData.cast.length > 0) {
            movieData.cast.forEach(person => {
                const item = document.createElement('div');
                item.className = 'cast-item';
                const imgSrc = person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : '';
                item.innerHTML = `<img src="${imgSrc}" alt="${person.name}" loading="lazy"><div class="cast-name">${person.name}</div><div class="cast-char">${person.character}</div>`;
                modalCast.appendChild(item);
            });
            modalCast.classList.remove('hidden');
        } else {
            modalCast.classList.add('hidden');
        }

        // Screenshots — carica solo quando visibili
        modalScreenshots.innerHTML = '';
        if (movieData.screenshots && Array.isArray(movieData.screenshots) && movieData.screenshots.length > 0) {
            movieData.screenshots.forEach(src => {
                const img = document.createElement('img');
                img.dataset.src = src; // Non caricare subito
                img.alt = `Screenshot di ${movieData.original_title}`;
                img.className = 'screenshot-img';
                modalScreenshots.appendChild(img);
            });
            modalScreenshots.classList.remove('hidden');
            // Lazy load con IntersectionObserver dentro la modale
            requestAnimationFrame(() => setupScreenshotObserver());
        } else {
            modalScreenshots.classList.add('hidden');
        }

        // Store current movie data for action buttons
        modal._currentMovie = movieData;

        // Watchlist eye button: show only if logged in + viewing watchlist
        const watchlistBtn = document.getElementById('modal-watchlist-btn');
        if (adminPassword && currentListName === 'watchlist') {
            watchlistBtn.classList.remove('hidden');
        } else {
            watchlistBtn.classList.add('hidden');
        }

        // Remove button: show only if logged in
        const removeBtn = document.getElementById('modal-remove-btn');
        if (adminPassword && currentListName) {
            removeBtn.classList.remove('hidden');
        } else {
            removeBtn.classList.add('hidden');
        }

        // Hide move popup
        document.getElementById('modal-move-popup').classList.add('hidden');

        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    };

    // Observer per caricare screenshot solo quando visibili nel scroll della modale
    let screenshotObserver = null;

    const setupScreenshotObserver = () => {
        if (screenshotObserver) screenshotObserver.disconnect();

        const modalContent = modal.querySelector('.modal-content');
        screenshotObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.dataset.src = '';
                        img.addEventListener('click', () => openLightbox(img.src));
                    }
                    screenshotObserver.unobserve(img);
                }
            });
        }, { root: modalContent, threshold: 0.1 });

        modalScreenshots.querySelectorAll('.screenshot-img').forEach(img => {
            screenshotObserver.observe(img);
        });
    };

    const closeModal = () => {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        // Pulisci tutto per liberare memoria
        modalPoster.src = '';
        modalTitle.textContent = '';
        modalMeta.textContent = '';
        modalOverview.textContent = '';
        const rvEl = modalRating.querySelector('.modal-rating-value');
        if (rvEl) rvEl.textContent = '';
        else modalRating.textContent = '';
        modalImdbButton.href = '#';
        document.getElementById('modal-tags').innerHTML = '';
        document.getElementById('modal-cast').innerHTML = '';
        document.getElementById('modal-cast').classList.add('hidden');
        // FIX: Pulisci screenshot per evitare memory leak
        if (screenshotObserver) {
            screenshotObserver.disconnect();
            screenshotObserver = null;
        }
        modalScreenshots.innerHTML = '';
        modalScreenshots.classList.add('hidden');
    };

    modalCloseButton.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (lightbox.classList.contains('visible')) {
                closeLightbox();
            } else if (!modal.classList.contains('hidden')) {
                closeModal();
            }
        }
    });

    const openLightbox = (src) => {
        lightboxImg.src = src;
        lightbox.classList.add('visible');
    };

    const closeLightbox = () => {
        lightbox.classList.remove('visible');
        setTimeout(() => { lightboxImg.src = ''; }, 300);
    };

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    // --- Modal Action Buttons ---

    // Download poster
    document.getElementById('modal-download-btn').addEventListener('click', async () => {
        const movie = modal._currentMovie;
        if (!movie || !movie.poster_path) return;
        const url = `https://image.tmdb.org/t/p/original${movie.poster_path}`;
        try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${(movie.original_title || 'poster').replace(/[^a-zA-Z0-9]/g, '_')}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (err) {
            // Fallback: open in new tab
            window.open(url, '_blank');
        }
    });

    // Share
    document.getElementById('modal-share-btn').addEventListener('click', async () => {
        const movie = modal._currentMovie;
        if (!movie) return;
        const year = movie.release_date ? movie.release_date.substring(0, 4) : '';
        const rating = movie['your-rating'] || '';
        const ratingText = rating ? ` — My rating: ${rating}` : '';
        const text = `${movie.original_title} (${year})${ratingText}\n${movie.overview || ''}`;
        const imdbUrl = movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}` : '';

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${movie.original_title} (${year})`,
                    text: text,
                    url: imdbUrl
                });
            } catch (err) { /* user cancelled */ }
        } else {
            // Fallback: copy to clipboard
            try {
                await navigator.clipboard.writeText(text + (imdbUrl ? '\n' + imdbUrl : ''));
                const btn = document.getElementById('modal-share-btn');
                const origHTML = btn.innerHTML;
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8l4 4 6-7"/></svg>';
                setTimeout(() => { btn.innerHTML = origHTML; }, 1500);
            } catch (err) {}
        }
    });

    // Watchlist — move to another list
    document.getElementById('modal-watchlist-btn').addEventListener('click', () => {
        const popup = document.getElementById('modal-move-popup');
        const listDiv = document.getElementById('modal-move-list');
        listDiv.innerHTML = '';

        manifestData.forEach(entry => {
            if (entry.slug === 'watchlist') return;
            const btn = document.createElement('button');
            btn.className = 'modal-move-list-btn';
            btn.textContent = humanizeSlug(entry.slug);
            btn.style.backgroundColor = entry.color || '#8e8e93';
            btn.addEventListener('click', () => moveFromWatchlist(entry.slug));
            listDiv.appendChild(btn);
        });

        popup.classList.remove('hidden');
    });

    document.getElementById('modal-move-cancel').addEventListener('click', () => {
        document.getElementById('modal-move-popup').classList.add('hidden');
    });

    async function moveFromWatchlist(targetSlug) {
        const movie = modal._currentMovie;
        if (!movie) return;

        // Ask for rating
        const rating = prompt(`Rate "${movie.original_title}" (e.g. 7/10).\nLeave empty to skip.`, movie['your-rating'] || '');
        if (rating === null) return; // User pressed Cancel

        document.getElementById('modal-move-popup').classList.add('hidden');

        // 1. Add to target list
        const addData = new FormData();
        // Auth via PHP session
        addData.append('list_slug', targetSlug);
        addData.append('action', 'add');
        addData.append('imdb_url', 'tmdb:' + movie.id);
        if (rating.trim()) addData.append('rating', rating.trim());

        try {
            await fetch('admin/update_list.php', { method: 'POST', body: addData });

            // 2. Remove from watchlist
            const rmData = new FormData();
            rmData.// session auth;
            rmData.append('list_slug', 'watchlist');
            rmData.append('action', 'remove');
            rmData.append('tmdb_id', movie.id);

            await fetch('admin/update_list.php', { method: 'POST', body: rmData });

            // Refresh
            delete allMoviesData['watchlist'];
            delete allMoviesData[targetSlug];
            closeModal();
            await loadCrossListMap();
            const activeBtn = navContainer.querySelector('.nav-button.selected');
            if (activeBtn) loadMovieList(currentListName, activeBtn);
        } catch (err) {
            alert('Error: ' + err.message);
        }
    }

    // Remove from list (with multi-list check)
    document.getElementById('modal-remove-btn').addEventListener('click', async () => {
        const movie = modal._currentMovie;
        if (!movie || !currentListName) return;

        const otherLists = getListTagsForMovie(movie.id);

        if (otherLists.length > 0) {
            // Movie is in multiple lists — ask user
            const choice = confirm(
                `"${movie.original_title}" is also in: ${otherLists.map(humanizeSlug).join(', ')}.\n\n` +
                `OK = Remove from ALL lists\nCancel = Remove only from "${humanizeSlug(currentListName)}"`
            );

            if (choice) {
                // Remove from all lists
                const allLists = [currentListName, ...otherLists];
                for (const slug of allLists) {
                    const fd = new FormData();
                    fd.// session auth;
                    fd.append('list_slug', slug);
                    fd.append('action', 'remove');
                    fd.append('tmdb_id', movie.id);
                    await fetch('admin/update_list.php', { method: 'POST', body: fd });
                    delete allMoviesData[slug];
                }
            } else {
                // Remove only from current list
                const fd = new FormData();
                fd.// session auth;
                fd.append('list_slug', currentListName);
                fd.append('action', 'remove');
                fd.append('tmdb_id', movie.id);
                await fetch('admin/update_list.php', { method: 'POST', body: fd });
                delete allMoviesData[currentListName];
            }
        } else {
            // Only in this list
            if (!confirm(`Remove "${movie.original_title}" from "${humanizeSlug(currentListName)}"?`)) return;
            const fd = new FormData();
            fd.// session auth;
            fd.append('list_slug', currentListName);
            fd.append('action', 'remove');
            fd.append('tmdb_id', movie.id);
            await fetch('admin/update_list.php', { method: 'POST', body: fd });
            delete allMoviesData[currentListName];
        }

        closeModal();
        await loadCrossListMap();
        const activeBtn = navContainer.querySelector('.nav-button.selected');
        if (activeBtn) loadMovieList(currentListName, activeBtn);
    });

    // --- Gestione Bottoni e Selezione Lista ---

    const applyBgTint = (color) => {
        // Color tinting disabled
    };

    const selectNavItem = (slug, triggerEl) => {
        // Deselect all
        navContainer.querySelectorAll('.nav-button').forEach(b => { b.classList.remove('selected'); b.style.backgroundColor = ''; b.style.color = ''; });
        navContainer.querySelectorAll('.nav-dropdown-btn').forEach(b => { b.classList.remove('has-selected'); b.style.backgroundColor = ''; b.style.color = ''; });
        navContainer.querySelectorAll('.nav-dropdown-item').forEach(b => b.classList.remove('active'));
        // Close all dropdowns
        navContainer.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));

        const entry = manifestData.find(e => e.slug === slug);
        const color = entry ? entry.color : '#007aff';

        if (triggerEl) {
            if (triggerEl.classList.contains('nav-button')) {
                triggerEl.classList.add('selected');
                triggerEl.style.backgroundColor = color;
                triggerEl.style.color = '#fff';
            } else if (triggerEl.classList.contains('nav-dropdown-item')) {
                triggerEl.classList.add('active');
                const ddBtn = triggerEl.closest('.nav-dropdown-wrap').querySelector('.nav-dropdown-btn');
                ddBtn.classList.add('has-selected');
                ddBtn.style.backgroundColor = color;
                ddBtn.style.color = '#fff';
                ddBtn.textContent = (entry ? entry.name : humanizeSlug(slug)) + ' ▾';
            }
        }

        applyBgTint(color);
        loadMovieList(slug, triggerEl);
    };

    const createNavButtons = async () => {
        try {
            const response = await fetchWithTimeout('liste/manifest.json');
            if (!response.ok) throw new Error(`Error loading manifest.json: ${response.status}`);
            const rawData = await response.json();

            manifestData = rawData.map(item => {
                if (typeof item === 'string') return { slug: item, name: humanizeSlug(item), description: '', color: '#8e8e93', protected: false };
                return { slug: item.slug, name: item.name || humanizeSlug(item.slug), description: item.description || '', color: item.color || '#8e8e93', protected: !!item.protected };
            });

            // Split lists into categories
            const favEntry = manifestData.find(e => e.slug === 'favourites');
            const wlEntry = manifestData.find(e => e.slug === 'watchlist');
            const seenLists = manifestData.filter(e => e.slug.startsWith('seen_')).sort((a,b) => a.slug.localeCompare(b.slug));
            const thematicLists = manifestData.filter(e => !['favourites','watchlist'].includes(e.slug) && !e.slug.startsWith('seen_'));

            // Favourites button
            if (favEntry) {
                const btn = document.createElement('button');
                btn.className = 'nav-button';
                btn.textContent = 'Favourites';
                btn.dataset.listName = favEntry.slug;
                btn.addEventListener('click', () => selectNavItem(favEntry.slug, btn));
                navContainer.appendChild(btn);
            }

            // Watchlist button
            if (wlEntry) {
                const btn = document.createElement('button');
                btn.className = 'nav-button';
                btn.textContent = 'Watchlist';
                btn.dataset.listName = wlEntry.slug;
                btn.addEventListener('click', () => selectNavItem(wlEntry.slug, btn));
                navContainer.appendChild(btn);
            }

            // Line break before dropdowns
            const brk = document.createElement('div');
            brk.className = 'nav-row-break';
            navContainer.appendChild(brk);

            // Watched dropdown
            if (seenLists.length) {
                const wrap = document.createElement('div');
                wrap.className = 'nav-dropdown-wrap';
                const ddBtn = document.createElement('button');
                ddBtn.className = 'nav-dropdown-btn';
                ddBtn.textContent = 'Watched ▾';
                ddBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menu = wrap.querySelector('.nav-dropdown-menu');
                    navContainer.querySelectorAll('.nav-dropdown-menu').forEach(m => { if (m !== menu) m.classList.remove('open'); });
                    menu.classList.toggle('open');
                });
                wrap.appendChild(ddBtn);

                const menu = document.createElement('div');
                menu.className = 'nav-dropdown-menu';
                seenLists.forEach(entry => {
                    const item = document.createElement('button');
                    item.className = 'nav-dropdown-item';
                    item.textContent = entry.name;
                    item.addEventListener('click', () => selectNavItem(entry.slug, item));
                    menu.appendChild(item);
                });
                wrap.appendChild(menu);
                navContainer.appendChild(wrap);
            }

            // Collections dropdown
            if (thematicLists.length) {
                const wrap = document.createElement('div');
                wrap.className = 'nav-dropdown-wrap';
                const ddBtn = document.createElement('button');
                ddBtn.className = 'nav-dropdown-btn';
                ddBtn.textContent = 'Collections ▾';
                ddBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menu = wrap.querySelector('.nav-dropdown-menu');
                    navContainer.querySelectorAll('.nav-dropdown-menu').forEach(m => { if (m !== menu) m.classList.remove('open'); });
                    menu.classList.toggle('open');
                });
                wrap.appendChild(ddBtn);

                const menu = document.createElement('div');
                menu.className = 'nav-dropdown-menu';
                thematicLists.forEach(entry => {
                    const item = document.createElement('button');
                    item.className = 'nav-dropdown-item';
                    item.textContent = entry.name;
                    item.addEventListener('click', () => selectNavItem(entry.slug, item));
                    menu.appendChild(item);
                });
                wrap.appendChild(menu);
                navContainer.appendChild(wrap);
            }

            // Close dropdowns on click outside
            document.addEventListener('click', () => {
                navContainer.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));
            });

        } catch (error) {
            showError(`Could not load lists. ${error.message}`);
        }
    };

    const highlightButton = (buttonElement) => {
        // handled by selectNavItem now
    };

     const deselectAllNavButtons = () => {
         navContainer.querySelectorAll('.nav-button').forEach(b => { b.classList.remove('selected'); b.style.backgroundColor = ''; b.style.color = ''; });
         navContainer.querySelectorAll('.nav-dropdown-btn').forEach(b => { b.classList.remove('has-selected'); b.style.backgroundColor = ''; b.style.color = ''; });
         navContainer.querySelectorAll('.nav-dropdown-item').forEach(b => b.classList.remove('active'));
    }

    // --- Filtraggio e Ordinamento ---

    const filterAndSortMovies = (movies, searchTerm, sortCriteria) => {
        let filteredMovies = movies;

        if (searchTerm) {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            filteredMovies = movies.filter(movie => {
                if (movie.original_title && movie.original_title.toLowerCase().includes(lowerCaseSearchTerm)) return true;
                if (movie.overview && movie.overview.toLowerCase().includes(lowerCaseSearchTerm)) return true;
                if (movie.release_date && movie.release_date.substring(0,4).includes(lowerCaseSearchTerm)) return true;
                // Search by director
                if (movie.directors && movie.directors.some(d => d.name.toLowerCase().includes(lowerCaseSearchTerm))) return true;
                // Search by actor
                if (movie.cast && movie.cast.some(a => a.name.toLowerCase().includes(lowerCaseSearchTerm))) return true;
                return false;
            });
        }

        if (sortCriteria) {
            const sortedMovies = [...filteredMovies];
            sortedMovies.sort((a, b) => {
                const handleNulls = (valA, valB, ascending = true) => {
                    const factor = ascending ? 1 : -1;
                    if (valA === null && valB === null) return 0;
                    if (valA === null) return 1 * factor;
                    if (valB === null) return -1 * factor;
                    return null;
                };

                switch (sortCriteria) {
                    case 'title-asc':
                        return (a.original_title || '').localeCompare(b.original_title || '');
                    case 'title-desc':
                        return (b.original_title || '').localeCompare(a.original_title || '');
                    case 'rating-asc': {
                        const nullComparison = handleNulls(a['your-rating-numeric'], b['your-rating-numeric'], true);
                        return nullComparison !== null ? nullComparison : (a['your-rating-numeric'] - b['your-rating-numeric']);
                    }
                    case 'rating-desc': {
                         const nullComparison = handleNulls(a['your-rating-numeric'], b['your-rating-numeric'], false);
                        return nullComparison !== null ? nullComparison : (b['your-rating-numeric'] - a['your-rating-numeric']);
                    }
                    case 'runtime-asc':
                        return (a.runtime || 0) - (b.runtime || 0);
                    case 'runtime-desc':
                        return (b.runtime || 0) - (a.runtime || 0);
                     case 'release-date-asc':
                        return (a['release-date-object'] || new Date(0)) - (b['release-date-object'] || new Date(0));
                    case 'release-date-desc':
                        return (b['release-date-object'] || new Date(0)) - (a['release-date-object'] || new Date(0));
                    case 'added-desc':
                        return (b.added_date || '').localeCompare(a.added_date || '');
                    case 'added-asc':
                        return (a.added_date || '').localeCompare(b.added_date || '');
                    default:
                        return 0;
                }
            });
            return sortedMovies;
        }

        return filteredMovies;
    };

    const applyFiltersAndSort = () => {
         if (!currentListName || !allMoviesData[currentListName]) return;
        const moviesToDisplay = filterAndSortMovies(allMoviesData[currentListName], currentSearchTerm, currentSortCriteria);
        displayMovies(moviesToDisplay);
    };

    // --- Gestione Tema (Dark Mode) ---

    const setupDarkMode = () => {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const savedTheme = localStorage.getItem('theme');

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.body.classList.add('dark-mode');
            darkModeToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        } else {
             darkModeToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        }

        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDarkMode = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
            darkModeToggle.innerHTML = isDarkMode ? '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
            // Re-apply or remove bg tint based on current list
            if (currentListName) {
                const entry = manifestData.find(e => e.slug === currentListName);
                applyBgTint(entry ? entry.color : null);
            }
        });
    };

    // --- Gestione Bottone Scroll-to-Top ---

    const setupScrollTopButton = () => {
        window.addEventListener('scroll', () => {
            scrollTopButton.classList.toggle('visible', window.scrollY > 300);
        }, { passive: true });

        scrollTopButton.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    };

    // --- Gestione Cambio Vista ---

    const setViewMode = (mode) => {
        moviesContainer.classList.remove('view-mode--cards', 'view-mode--posters');
        moviesContainer.classList.add(`view-mode--${mode}`);
        currentViewMode = mode;
        viewToggleButton.textContent = mode === 'cards' ? '🖼️ Grid' : '📄 Cards';
        localStorage.setItem('viewMode', mode);
    };

    const toggleViewMode = () => {
        const newMode = currentViewMode === 'cards' ? 'posters' : 'cards';
        setViewMode(newMode);
    };

     const setupViewToggle = () => {
         const savedViewMode = localStorage.getItem('viewMode') || 'cards';
         setViewMode(savedViewMode);
         viewToggleButton.addEventListener('click', toggleViewMode);
     }

    // --- Funzione per deselezionare la lista ---
    const deselectList = () => {
        currentMovies = [];
        moviesContainer.innerHTML = '';
        filterControls.classList.add('hidden');
        welcomeMessage.style.display = 'block';
        h1Title.classList.add('selected');
        currentListName = null;
        currentSearchTerm = '';
        currentSortCriteria = '';
        searchBar.value = '';
        sortSelect.value = '';
        listDescription.classList.add('hidden');
        hideError();
        deselectAllNavButtons();
        applyBgTint(null);
        // Reset dropdown labels
        navContainer.querySelectorAll('.nav-dropdown-wrap').forEach(w => {
            const btn = w.querySelector('.nav-dropdown-btn');
            const items = w.querySelectorAll('.nav-dropdown-item');
            const isWatched = Array.from(items).some(i => i.textContent.includes('Seen'));
            btn.textContent = (isWatched ? 'Watched' : 'Collections') + ' ▾';
        });
        closeModal();
    };

    // ============================================================
    // --- ADMIN PANEL ---
    // ============================================================

    const adminShowResponse = (message, type) => {
        adminResponse.textContent = message;
        adminResponse.className = 'admin-response ' + type;
        adminResponse.classList.remove('hidden');
    };

    const adminHideResponse = () => {
        adminResponse.classList.add('hidden');
    };

    // Toggle popup on lock icon click
    adminToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        adminPopup.classList.toggle('hidden');
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!adminPopup.contains(e.target) && e.target !== adminToggle) {
            adminPopup.classList.add('hidden');
        }
    });

    // Login
    adminLoginBtn.addEventListener('click', async () => {
        const pwd = adminPasswordInput.value.trim();
        if (!pwd) return;
        adminLoginBtn.disabled = true;
        adminLoginBtn.textContent = '...';

        try {
            const formData = new FormData();
            formData.append('action', 'login');
            formData.append('password', pwd);

            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();

            if (resp.ok && data.status === 'ok') {
                adminPassword = '***SESSION***';
                adminToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v1"/></svg>';
                adminPopupLogin.classList.add('hidden');
                adminPopupLogout.classList.remove('hidden');
                adminPopup.classList.add('hidden');
                adminManageBar.classList.remove('hidden');
                adminLoadLists();
            } else {
                adminPasswordInput.value = '';
                adminPasswordInput.placeholder = 'Wrong password!';
                setTimeout(() => { adminPasswordInput.placeholder = 'Password...'; }, 2000);
            }
        } catch (err) {
            adminPasswordInput.value = '';
            adminPasswordInput.placeholder = 'Connection error!';
            setTimeout(() => { adminPasswordInput.placeholder = 'Password...'; }, 2000);
        } finally {
            adminLoginBtn.disabled = false;
            adminLoginBtn.textContent = 'Login';
        }
    });

    adminPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') adminLoginBtn.click();
    });

    // Logout
    adminLogoutBtn.addEventListener('click', async () => {
        const fd = new FormData(); fd.append('action', 'logout');
        await fetch('admin/update_list.php', { method: 'POST', body: fd }).catch(() => {});
        adminPassword = '';
        adminPasswordInput.value = '';
        adminToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
        adminPopupLogin.classList.remove('hidden');
        adminPopupLogout.classList.add('hidden');
        adminPopup.classList.add('hidden');
        adminManageBar.classList.add('hidden');
        adminPanel.classList.add('hidden');
        adminHideResponse();
        document.getElementById('adminForm').reset();
        adminListSelect.innerHTML = '<option value="" disabled selected>Select...</option>';
        adminDescriptionInput.value = '';
        adminAction.value = '';
        document.getElementById('admin-new-list-fields').classList.add('hidden');
        document.getElementById('admin-search-fields').classList.add('hidden');
        document.getElementById('admin-imdb-fields').classList.add('hidden');
        document.getElementById('admin-rating-fields').classList.add('hidden');
        document.getElementById('admin-movie-select-fields').classList.add('hidden');
        document.getElementById('admin-screenshot-movie-fields').classList.add('hidden');
        adminSubmitBtn.classList.add('hidden');
        document.getElementById('admin-screenshot-manager').classList.add('hidden');
    });

    // Toggle admin panel visibility
    adminManageToggle.addEventListener('click', () => {
        adminPanel.classList.toggle('hidden');
        adminManageToggle.textContent = adminPanel.classList.contains('hidden') ? 'Manage Lists' : 'Hide Panel';
    });

    // Carica liste nel dropdown admin
    const adminLoadLists = () => {
        adminListSelect.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = ''; defaultOpt.textContent = 'Select...';
        defaultOpt.disabled = true; defaultOpt.selected = true;
        adminListSelect.appendChild(defaultOpt);

        const newOpt = document.createElement('option');
        newOpt.value = '__new__'; newOpt.textContent = 'New list…';
        adminListSelect.appendChild(newOpt);

        manifestData.forEach(entry => {
            const opt = document.createElement('option');
            opt.value = entry.slug;
            opt.textContent = entry.slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            adminListSelect.appendChild(opt);
        });
    };

    // Cambio lista selezionata
    adminListSelect.addEventListener('change', () => {
        const newListFields = document.getElementById('admin-new-list-fields');
        if (adminListSelect.value === '__new__') {
            newListFields.classList.remove('hidden');
            adminDescriptionInput.value = '';
        } else {
            newListFields.classList.add('hidden');
            // Carica descrizione corrente
            adminDescriptionInput.value = getDescriptionForList(adminListSelect.value);
        }
        adminUpdateFieldVisibility();
    });

    // Salva descrizione
    adminSaveDescriptionBtn.addEventListener('click', async () => {
        const slug = adminListSelect.value;
        if (!slug || slug === '__new__') return;

        const newDesc = adminDescriptionInput.value.trim();
        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', slug);
        formData.append('action', 'update_description');
        formData.append('description', newDesc);

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status === 'description_updated') {
                // Aggiorna dati locali
                const entry = manifestData.find(e => e.slug === slug);
                if (entry) entry.description = newDesc;
                // Aggiorna descrizione visibile se è la lista corrente
                if (currentListName === slug) {
                    if (newDesc) {
                        listDescription.textContent = newDesc;
                        listDescription.classList.remove('hidden');
                    } else {
                        listDescription.classList.add('hidden');
                    }
                }
                adminShowResponse('Description updated!', 'success');
            } else {
                adminShowResponse('Error: ' + (data.error || 'unknown'), 'error');
            }
        } catch (err) {
            adminShowResponse('Network error: ' + err.message, 'error');
        }
    });

    // Cambio azione
    adminAction.addEventListener('change', adminUpdateFieldVisibility);

    function adminUpdateFieldVisibility() {
        const action = adminAction.value;
        // Hide/show delete option based on protected status
        const deleteOpt = adminAction.querySelector('option[value="delete"]');
        if (deleteOpt) {
            const selectedList = manifestData.find(e => e.slug === adminListSelect.value);
            deleteOpt.disabled = selectedList && selectedList.protected;
            if (deleteOpt.disabled && action === 'delete') adminAction.value = '';
        }
        const searchFields = document.getElementById('admin-search-fields');
        const imdbFields = document.getElementById('admin-imdb-fields');
        const ratingFields = document.getElementById('admin-rating-fields');
        const movieSelectFields = document.getElementById('admin-movie-select-fields');
        const screenshotMovieFields = document.getElementById('admin-screenshot-movie-fields');
        const screenshotManager = document.getElementById('admin-screenshot-manager');

        searchFields.classList.add('hidden');
        imdbFields.classList.add('hidden');
        ratingFields.classList.add('hidden');
        movieSelectFields.classList.add('hidden');
        screenshotMovieFields.classList.add('hidden');
        adminSubmitBtn.classList.add('hidden');
        screenshotManager.classList.add('hidden');
        adminHideResponse();

        if (action === 'add') {
            searchFields.classList.remove('hidden');
            imdbFields.classList.remove('hidden');
            ratingFields.classList.remove('hidden');
            adminSubmitBtn.classList.remove('hidden');
        } else if (action === 'remove') {
            movieSelectFields.classList.remove('hidden');
            adminSubmitBtn.classList.remove('hidden');
            if (adminListSelect.value && adminListSelect.value !== '__new__') {
                adminLoadListMovies(adminListSelect.value);
            }
        } else if (action === 'manage_screenshots') {
            screenshotMovieFields.classList.remove('hidden');
            if (adminListSelect.value && adminListSelect.value !== '__new__') {
                adminLoadMoviesWithScreenshots(adminListSelect.value);
            }
        } else if (action === 'create' || action === 'delete') {
            adminSubmitBtn.classList.remove('hidden');
        }
    }

    // Carica film della lista per dropdown rimozione
    async function adminLoadListMovies(listSlug) {
        const movieSelect = document.getElementById('admin-movie-select');
        movieSelect.innerHTML = '<option value="" disabled selected>Loading...</option>';

        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', listSlug);
        formData.append('action', 'get_list_movies');

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status === 'ok') {
                movieSelect.innerHTML = '';
                if (data.movies.length === 0) {
                    movieSelect.innerHTML = '<option value="" disabled selected>No movies</option>';
                    return;
                }
                const def = document.createElement('option');
                def.value = ''; def.textContent = 'Select movie...';
                def.disabled = true; def.selected = true;
                movieSelect.appendChild(def);
                data.movies.forEach(movie => {
                    const opt = document.createElement('option');
                    opt.value = movie.id;
                    opt.textContent = movie.title + (movie.year ? ` (${movie.year})` : '');
                    movieSelect.appendChild(opt);
                });
            } else {
                movieSelect.innerHTML = '<option value="" disabled selected>Error</option>';
            }
        } catch (err) {
            movieSelect.innerHTML = '<option value="" disabled selected>Network error</option>';
        }
    }

    // Ricerca TMDB
    const adminSearchInput = document.getElementById('admin-search-input');
    const adminSearchResults = document.getElementById('admin-search-results');
    const adminSearchSpinner = document.getElementById('admin-search-spinner');

    adminSearchInput.addEventListener('input', (e) => {
        clearTimeout(adminSearchTimeout);
        adminSearchTimeout = setTimeout(() => adminSearchMovies(e.target.value.trim()), 400);
    });

    let adminSearchRequestId = 0;

    async function adminSearchMovies(query) {
        if (!query || query.length < 2) {
            adminSearchResults.classList.add('hidden');
            adminSearchSpinner.classList.add('hidden');
            return;
        }

        const thisRequestId = ++adminSearchRequestId;
        adminSearchSpinner.classList.remove('hidden');

        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', adminListSelect.value || 'temp');
        formData.append('action', 'search_movies');
        formData.append('query', query);

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();

            // Ignora risposte obsolete (l'utente ha digitato altro nel frattempo)
            if (thisRequestId !== adminSearchRequestId) return;

            adminSearchSpinner.classList.add('hidden');

            if (data.status === 'ok') {
                adminSearchResults.innerHTML = '';
                if (data.results.length === 0) {
                    adminSearchResults.innerHTML = '<div class="admin-search-no-results">No results</div>';
                } else {
                    data.results.forEach(movie => {
                        const item = document.createElement('div');
                        item.className = 'admin-search-result-item';
                        item.addEventListener('mousedown', (e) => {
                            e.preventDefault();
                            document.getElementById('admin-imdb-url').value = 'tmdb:' + movie.id;
                            adminSearchInput.value = movie.original_title + (movie.year ? ` (${movie.year})` : '');
                            adminSearchResults.classList.add('hidden');
                            // Auto-fill rating if movie already in list
                            adminFetchExistingRating('tmdb:' + movie.id);
                        });

                        const img = document.createElement('img');
                        img.src = movie.poster || '';
                        img.alt = movie.title;

                        const info = document.createElement('div');
                        info.className = 'admin-search-result-info';
                        info.innerHTML = `<div class="admin-search-result-title">${movie.original_title}</div><div class="admin-search-result-year">${movie.year || 'N/A'}</div>`;

                        item.appendChild(img);
                        item.appendChild(info);
                        adminSearchResults.appendChild(item);
                    });
                }
                adminSearchResults.classList.remove('hidden');
            } else {
                adminSearchResults.innerHTML = '<div class="admin-search-no-results">Error: ' + (data.error || 'unknown') + '</div>';
                adminSearchResults.classList.remove('hidden');
            }
        } catch (err) {
            if (thisRequestId !== adminSearchRequestId) return;
            adminSearchSpinner.classList.add('hidden');
            adminSearchResults.innerHTML = '<div class="admin-search-no-results">Network error</div>';
            adminSearchResults.classList.remove('hidden');
        }
    }

    // Fetch existing rating when selecting a movie already in the list
    async function adminFetchExistingRating(imdbUrl) {
        const ratingInput = document.getElementById('admin-rating');
        ratingInput.value = '';

        const formData = new FormData();
        formData.// session auth;
        formData.append('action', 'get_global_movie_info');
        formData.append('imdb_url', imdbUrl);
        formData.append('list_slug', 'any');

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status === 'found' && data.rating) {
                ratingInput.value = data.rating;
            }
        } catch (err) {
            // ignore
        }
    }

    // Chiudi risultati ricerca cliccando fuori (usa mousedown per evitare conflitti)
    document.addEventListener('mousedown', (e) => {
        const searchFields = document.getElementById('admin-search-fields');
        if (searchFields && !searchFields.contains(e.target)) {
            adminSearchResults.classList.add('hidden');
        }
    });

    // Load movies with screenshots for the dropdown
    async function adminLoadMoviesWithScreenshots(listSlug) {
        const select = document.getElementById('admin-screenshot-movie-select');
        select.innerHTML = '<option value="" disabled selected>Loading...</option>';

        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', listSlug);
        formData.append('action', 'get_movies_with_screenshots');

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status === 'ok') {
                select.innerHTML = '';
                if (data.movies.length === 0) {
                    select.innerHTML = '<option value="" disabled selected>No movies with screenshots</option>';
                    return;
                }
                const def = document.createElement('option');
                def.value = ''; def.textContent = 'Select movie...';
                def.disabled = true; def.selected = true;
                select.appendChild(def);
                data.movies.forEach(movie => {
                    const opt = document.createElement('option');
                    opt.value = movie.id;
                    opt.textContent = movie.title + (movie.year ? ` (${movie.year})` : '') + ` [${movie.screenshot_count}]`;
                    select.appendChild(opt);
                });
            }
        } catch (err) {
            select.innerHTML = '<option value="" disabled selected>Network error</option>';
        }
    }

    // When a movie is selected from screenshot dropdown, load its screenshots
    document.getElementById('admin-screenshot-movie-select').addEventListener('change', async (e) => {
        const tmdbId = e.target.value;
        if (!tmdbId) return;

        adminShowResponse('Loading...', 'loading');

        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', adminListSelect.value);
        formData.append('action', 'get_movie_details');
        formData.append('imdb_url', 'tmdb:' + tmdbId);

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();

            if (data.status === 'found') {
                adminHideResponse();
                const manager = document.getElementById('admin-screenshot-manager');
                const grid = document.getElementById('admin-screenshots-grid');
                const titleRef = document.getElementById('admin-movie-title-ref');

                manager.classList.remove('hidden');
                titleRef.textContent = data.title;
                grid.innerHTML = '';

                if (data.screenshots && data.screenshots.length > 0) {
                    data.screenshots.forEach(src => {
                        const item = document.createElement('div');
                        item.className = 'screenshot-item';
                        const img = document.createElement('img');
                        img.src = src;
                        const delBtn = document.createElement('button');
                        delBtn.className = 'delete-ss-btn';
                        delBtn.innerHTML = '&times;';
                        delBtn.addEventListener('click', () => adminDeleteScreenshot(tmdbId, src, item));
                        item.appendChild(img);
                        item.appendChild(delBtn);
                        grid.appendChild(item);
                    });
                } else {
                    grid.innerHTML = '<p class="admin-hint" style="grid-column:1/-1;text-align:center;">No screenshots.</p>';
                }
            } else {
                adminShowResponse('Error: ' + (data.error || 'Movie not found'), 'error');
            }
        } catch (err) {
            adminShowResponse('Network error: ' + err.message, 'error');
        }
    });

    async function adminDeleteScreenshot(tmdbId, path, element) {
        if (!confirm('Delete this image?')) return;

        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', adminListSelect.value);
        formData.append('action', 'delete_single_screenshot');
        formData.append('imdb_url', 'tmdb:' + tmdbId);
        formData.append('screenshot_path', path);

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status === 'screenshot_deleted') {
                element.remove();
                const grid = document.getElementById('admin-screenshots-grid');
                if (grid.children.length === 0) {
                    grid.innerHTML = '<p class="admin-hint" style="grid-column:1/-1;text-align:center;">All deleted.</p>';
                }
            } else {
                alert('Error: ' + (data.error || 'unknown'));
            }
        } catch (err) {
            alert('Network error: ' + err.message);
        }
    }

    // Submit form admin
    document.getElementById('adminForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const action = adminAction.value;
        if (!action || action === 'manage_screenshots') return;

        adminSubmitBtn.disabled = true;
        adminSubmitBtn.textContent = 'Wait...';
        adminShowResponse('Operation in progress...', 'loading');

        const listSlug = adminListSelect.value === '__new__'
            ? document.getElementById('admin-new-list-name').value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
            : adminListSelect.value;

        if (!listSlug) {
            adminShowResponse('Select or create a list.', 'error');
            adminSubmitBtn.disabled = false;
            adminSubmitBtn.textContent = 'Submit';
            return;
        }

        const formData = new FormData();
        formData.// session auth;
        formData.append('list_slug', listSlug);
        formData.append('action', action);

        if (adminListSelect.value === '__new__') {
            formData.append('list_name', document.getElementById('admin-new-list-name').value.trim());
        }

        if (action === 'remove') {
            const movieSelect = document.getElementById('admin-movie-select');
            if (!movieSelect.value) {
                adminShowResponse('Select a movie.', 'error');
                adminSubmitBtn.disabled = false;
                adminSubmitBtn.textContent = 'Submit';
                return;
            }
            formData.append('tmdb_id', movieSelect.value);
        }

        if (action === 'add') {
            const imdbUrl = document.getElementById('admin-imdb-url').value.trim();
            const rating = document.getElementById('admin-rating').value.trim();
            const screenshotsInput = document.getElementById('admin-screenshots');

            if (imdbUrl) formData.append('imdb_url', imdbUrl);
            if (rating) formData.append('rating', rating);

            if (screenshotsInput.files.length > 0) {
                for (let i = 0; i < screenshotsInput.files.length; i++) {
                    formData.append('screenshots[]', screenshotsInput.files[i]);
                }
            }
        }

        try {
            const resp = await fetch('admin/update_list.php', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.status) {
                adminShowResponse('Operation successful!', 'success');
                // Ricarica manifest se creata/eliminata lista
                if (action === 'create' || action === 'delete') {
                    const mResp = await fetchWithTimeout('liste/manifest.json');
                    const rawData = await mResp.json();
                    manifestData = rawData.map(item =>
                        typeof item === 'string' ? { slug: item, description: '', color: '#8e8e93', protected: false } : { slug: item.slug, description: item.description || '', color: item.color || '#8e8e93', protected: !!item.protected }
                    );
                    adminLoadLists();
                    // Ricostruisci nav
                    navContainer.innerHTML = '';
                    manifestData.forEach(entry => {
                        const button = document.createElement('button');
                        button.className = 'nav-button';
                        button.textContent = entry.slug.replace(/[_\-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
                        button.dataset.listName = entry.slug;
                        button.addEventListener('click', () => loadMovieList(entry.slug, button));
                        navContainer.appendChild(button);
                    });
                }
                // Invalidate cache della lista modificata
                if (action === 'add' || action === 'remove') {
                    delete allMoviesData[listSlug];
                }
                if (action === 'add') {
                    document.getElementById('admin-screenshots').value = '';
                }
            } else {
                adminShowResponse('Error: ' + (data.error || JSON.stringify(data)), 'error');
            }
        } catch (err) {
            adminShowResponse('Network error: ' + err.message, 'error');
        } finally {
            adminSubmitBtn.disabled = false;
            adminSubmitBtn.textContent = 'Submit';
        }
    });

    // --- Event Listeners ---

    searchBar.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value;
        applyFiltersAndSort();
    });

    sortSelect.addEventListener('change', (e) => {
        currentSortCriteria = e.target.value;
        applyFiltersAndSort();
    });

    h1Title.addEventListener('click', deselectList);

    // --- Inizializzazione ---
    const initializeApp = async () => {
        welcomeMessage.style.display = 'block';
        h1Title.classList.add('selected');
        setupDarkMode();
        setupScrollTopButton();
        setupViewToggle();
        await loadCrossListMap();
        createNavButtons();
    };

    initializeApp();
});
