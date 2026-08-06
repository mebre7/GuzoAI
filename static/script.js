// ============================================
// NAVIGATION & MOBILE MENU
// ============================================
function toggleMobileMenu() {
    const menu = document.querySelector('.navbar-menu');
    menu?.classList.toggle('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelector('.navbar-menu')?.classList.remove('active');
    });
});

// ============================================
// FAQ TOGGLE
// ============================================
function toggleFAQ(element) {
    const answer = element.nextElementSibling;
    const icon = element.querySelector('.faq-icon');

    document.querySelectorAll('.faq-answer.open').forEach(el => {
        if (el !== answer) {
            el.classList.remove('open');
            el.previousElementSibling.querySelector('.faq-icon').textContent = '+';
        }
    });

    answer.classList.toggle('open');
    icon.textContent = answer.classList.contains('open') ? '−' : '+';
}

// ============================================
// SMOOTH SCROLL & ANCHOR NAVIGATION
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href !== '#' && document.querySelector(href)) {
            e.preventDefault();
            document.querySelector(href).scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ============================================
// STATE MANAGEMENT
// ============================================
let currentThreadId = null;
let isLoading = false;
let lastResultData = null;
let flightsPanelVisible = false;

const LOADING_MESSAGES = [
    'Searching for flights...',
    'Finding the best hotels...',
    'Building your itinerary...',
    'Finalizing your travel plan...'
];

// ============================================
// DOM ELEMENTS
// ============================================
const planForm = document.getElementById('planForm');
const userInput = document.getElementById('userInput');
const inputSection = document.querySelector('.input-section');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const loadingMessage = document.getElementById('loadingMessage');
const progressFill = document.getElementById('progressFill');
const submitBtn = document.querySelector('.submit-btn');
const btnText = document.querySelector('.btn-text');
const btnSpinner = document.querySelector('.btn-spinner');

// ============================================
// EVENT LISTENERS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    planForm.addEventListener('submit', handleFormSubmit);
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
});

// ============================================
// FORM SUBMISSION
// ============================================
async function handleFormSubmit(e) {
    e.preventDefault();

    if (!userInput.value.trim()) {
        showError('Please enter your travel preferences.');
        return;
    }

    if (isLoading) return;

    isLoading = true;
    submitBtn.disabled = true;
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');

    let loadingInterval = null;

    try {
        inputSection.classList.add('hidden');
        errorSection.classList.add('hidden');
        resultsSection.classList.add('hidden');
        loadingSection.classList.remove('hidden');

        document.getElementById('planner')?.scrollIntoView({ behavior: 'smooth' });
        loadingInterval = simulateProgress();

        const response = await fetch('/api/travel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userInput.value.trim(),
                thread_id: currentThreadId
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || `Request failed (${response.status})`);
        }

        currentThreadId = data.thread_id;
        progressFill.style.width = '100%';
        displayResults(data);

    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'Failed to generate itinerary. Please try again.');
    } finally {
        if (loadingInterval) clearInterval(loadingInterval);
        isLoading = false;
        submitBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
    }
}

// ============================================
// RESULTS DISPLAY
// ============================================
function displayResults(data) {
    lastResultData = data;
    flightsPanelVisible = false;

    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    errorSection.classList.add('hidden');

    displaySummary(data.answer || data.itinerary);
    displayHotels(data.hotel_results);
    resetFlightsPanel(data.flight_results);

    setTimeout(() => {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

function displaySummary(summary) {
    const container = document.getElementById('summaryContent');

    if (!summary) {
        container.innerHTML = '<p class="empty-state">No travel plan generated. Try a more detailed query.</p>';
        return;
    }

    const text = typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2);
    container.innerHTML = renderMarkdown(text);
}

function displayHotels(hotels) {
    const container = document.getElementById('hotelsContent');

    if (!hotels) {
        container.innerHTML = '<p class="empty-state">No hotel recommendations found.</p>';
        return;
    }

    if (typeof hotels === 'string') {
        container.innerHTML = `<div class="markdown-body">${renderMarkdown(hotels)}</div>`;
        return;
    }

    const hotelList = Array.isArray(hotels) ? hotels : [hotels];
    if (hotelList.length === 0) {
        container.innerHTML = '<p class="empty-state">No hotels found. Try adjusting your preferences.</p>';
        return;
    }

    if (typeof hotelList[0] === 'string') {
        container.innerHTML = hotelList.map((item, index) => renderHotelCard(parseHotelString(item), index + 1)).join('');
        return;
    }

    container.innerHTML = hotelList.slice(0, 5).map((hotel, index) => `
        <div class="hotel-link-card">
            <div class="hotel-link-header">
                <span class="hotel-link-rank">${index + 1}</span>
                <div class="hotel-link-title">${escapeHtml(hotel.name || 'Hotel')}</div>
            </div>
            ${hotel.location ? `<p class="hotel-link-snippet"><strong>Location:</strong> ${escapeHtml(hotel.location)}</p>` : ''}
            ${hotel.rating ? `<p class="hotel-link-snippet"><strong>Rating:</strong> ${escapeHtml(String(hotel.rating))}/5</p>` : ''}
            ${hotel.price_per_night || hotel.price ? `<p class="hotel-link-snippet"><strong>Price:</strong> ${escapeHtml(hotel.price_per_night || formatPrice(hotel.price))}</p>` : ''}
        </div>
    `).join('');
}

function resetFlightsPanel(flights) {
    const panel = document.getElementById('flightsPanel');
    const btn = document.getElementById('toggleFlightsBtn');
    const hint = document.getElementById('flightsHint');
    const container = document.getElementById('flightsContent');

    panel.classList.add('hidden');
    flightsPanelVisible = false;
    container.innerHTML = '';

    const hasFlights = flights && (typeof flights === 'string' ? flights.trim() : flights.length > 0);

    if (hasFlights) {
        btn.disabled = false;
        btn.textContent = '✈️ View Live Flights';
        hint.textContent = 'Optional — raw live flight status from AviationStack (not ticket prices)';
        hint.classList.remove('hidden');
    } else {
        btn.disabled = true;
        btn.textContent = '✈️ No Live Flights Available';
        hint.textContent = 'Flight data was not returned for this query';
    }
}

function toggleLiveFlights() {
    if (!lastResultData?.flight_results) return;

    const panel = document.getElementById('flightsPanel');
    const btn = document.getElementById('toggleFlightsBtn');

    flightsPanelVisible = !flightsPanelVisible;

    if (flightsPanelVisible) {
        displayFlights(lastResultData.flight_results);
        panel.classList.remove('hidden');
        btn.textContent = '✈️ Hide Live Flights';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        panel.classList.add('hidden');
        btn.textContent = '✈️ View Live Flights';
    }
}

function displayFlights(flights) {
    const container = document.getElementById('flightsContent');

    if (!flights) {
        container.innerHTML = '<p class="empty-state">No flight data available.</p>';
        return;
    }

    if (typeof flights === 'string') {
        const sections = flights.split(/\n\n---\n\n/).map(s => s.trim()).filter(Boolean);

        if (sections.length > 1 || sections[0]?.includes('Airline:')) {
            container.innerHTML = sections.map(section => renderFlightCard(parseFlightBlock(section))).join('');
            return;
        }

        container.innerHTML = `<div class="flight-text-notice">${escapeHtml(flights)}</div>`;
        return;
    }

    const flightList = Array.isArray(flights) ? flights : [flights];
    container.innerHTML = flightList.slice(0, 10).map(flight => renderFlightCard(flight)).join('');
}

// ============================================
// PARSERS & RENDERERS
// ============================================
function parseFlightBlock(text) {
    const flight = {
        airline: '',
        flight_number: '',
        status: '',
        departure: {},
        arrival: {}
    };

    let section = null;

    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('Airline:')) {
            flight.airline = trimmed.slice(8).trim();
        } else if (trimmed.startsWith('Flight:')) {
            flight.flight_number = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('Status:')) {
            flight.status = trimmed.slice(7).trim();
        } else if (trimmed === 'Departure:') {
            section = 'departure';
        } else if (trimmed === 'Arrival:') {
            section = 'arrival';
        } else if (trimmed.startsWith('- ') && section) {
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx > -1) {
                const key = trimmed.slice(2, colonIdx).trim().toLowerCase();
                flight[section][key] = trimmed.slice(colonIdx + 1).trim();
            }
        }
    }

    return flight;
}

function parseHotelString(item) {
    const numbered = item.match(/^\d+\.\s+\*\*(.+?)\*\*\s*\n\s*(https?:\/\/\S+)\s*\n?\s*(.*)/s);
    if (numbered) {
        return { title: numbered[1].trim(), url: numbered[2].trim(), snippet: numbered[3].trim() };
    }

    const urlMatch = item.match(/(https?:\/\/\S+)/);
    return {
        title: item.replace(/\*\*/g, '').replace(urlMatch?.[0] || '', '').trim() || 'Hotel',
        url: urlMatch?.[1] || '',
        snippet: ''
    };
}

function renderFlightCard(flight) {
    if (typeof flight === 'string') {
        flight = parseFlightBlock(flight);
    }

    const depIata = flight.departure?.iata || flight.dep_iata || flight.departure_airport || '—';
    const arrIata = flight.arrival?.iata || flight.arr_iata || flight.arrival_airport || '—';
    const depAirport = flight.departure?.airport || '';
    const arrAirport = flight.arrival?.airport || '';
    const depTime = flight.departure?.scheduled || flight.departure_time || '';
    const arrTime = flight.arrival?.scheduled || flight.arrival_time || '';
    const depTerminal = flight.departure?.terminal;
    const arrTerminal = flight.arrival?.terminal;

    return `
        <div class="flight-card">
            <div class="flight-card-header">
                <div>
                    <div class="flight-airline">${escapeHtml(flight.airline || 'Unknown airline')}</div>
                    ${flight.flight_number ? `<div class="flight-number">${escapeHtml(flight.flight_number)}</div>` : ''}
                </div>
                ${flight.status ? `<span class="flight-status">${escapeHtml(flight.status)}</span>` : ''}
            </div>
            <div class="flight-endpoint departure">
                <div class="flight-iata">${escapeHtml(depIata)}</div>
                ${depAirport ? `<div class="flight-airport">${escapeHtml(depAirport)}</div>` : ''}
                ${depTime ? `<div class="flight-time">${escapeHtml(formatFlightTime(depTime))}</div>` : ''}
                ${depTerminal && depTerminal !== 'N/A' ? `<div class="flight-meta">Terminal ${escapeHtml(depTerminal)}</div>` : ''}
            </div>
            <div class="flight-route-arrow">
                <div class="flight-route-line"></div>
                ✈
            </div>
            <div class="flight-endpoint arrival">
                <div class="flight-iata">${escapeHtml(arrIata)}</div>
                ${arrAirport ? `<div class="flight-airport">${escapeHtml(arrAirport)}</div>` : ''}
                ${arrTime ? `<div class="flight-time">${escapeHtml(formatFlightTime(arrTime))}</div>` : ''}
                ${arrTerminal && arrTerminal !== 'N/A' ? `<div class="flight-meta">Terminal ${escapeHtml(arrTerminal)}</div>` : ''}
            </div>
        </div>
    `;
}

function renderHotelCard(hotel, rank) {
    const titleHtml = hotel.url
        ? `<a href="${escapeHtml(hotel.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hotel.title)}</a>`
        : escapeHtml(hotel.title);

    return `
        <div class="hotel-link-card">
            <div class="hotel-link-header">
                <span class="hotel-link-rank">${rank}</span>
                <div class="hotel-link-title">${titleHtml}</div>
            </div>
            ${hotel.url ? `<div class="hotel-link-url">${escapeHtml(hotel.url)}</div>` : ''}
            ${hotel.snippet ? `<p class="hotel-link-snippet">${escapeHtml(hotel.snippet)}</p>` : ''}
        </div>
    `;
}

function renderMarkdown(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let inList = false;
    let listType = null;

    const closeList = () => {
        if (inList) {
            html.push(listType === 'ol' ? '</ol>' : '</ul>');
            inList = false;
            listType = null;
        }
    };

    const formatInline = (str) => {
        return escapeHtml(str)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
                const safeUrl = /^https?:\/\//i.test(url.trim()) ? escapeHtml(url.trim()) : '#';
                return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            });
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            closeList();
            continue;
        }

        if (/^---+$/.test(trimmed)) {
            closeList();
            html.push('<hr>');
            continue;
        }

        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            closeList();
            const level = headingMatch[1].length;
            html.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
            continue;
        }

        const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
        if (ulMatch) {
            if (!inList || listType !== 'ul') {
                closeList();
                html.push('<ul>');
                inList = true;
                listType = 'ul';
            }
            html.push(`<li>${formatInline(ulMatch[1])}</li>`);
            continue;
        }

        const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (olMatch) {
            if (!inList || listType !== 'ol') {
                closeList();
                html.push('<ol>');
                inList = true;
                listType = 'ol';
            }
            html.push(`<li>${formatInline(olMatch[1])}</li>`);
            continue;
        }

        closeList();
        html.push(`<p>${formatInline(trimmed)}</p>`);
    }

    closeList();
    return html.join('\n');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function formatPrice(price) {
    if (!price) return 'N/A';
    if (typeof price === 'number') return `$${price.toFixed(2)}`;
    return price.toString();
}

function formatFlightTime(isoString) {
    if (!isoString || isoString === 'Unknown') return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return isoString;
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return isoString;
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function simulateProgress() {
    progressFill.style.width = '10%';
    let step = 0;
    loadingMessage.textContent = LOADING_MESSAGES[0];

    const interval = setInterval(() => {
        step = Math.min(step + 1, LOADING_MESSAGES.length - 1);
        loadingMessage.textContent = LOADING_MESSAGES[step];
    }, 3000);

    setTimeout(() => { progressFill.style.width = '30%'; }, 500);
    setTimeout(() => { progressFill.style.width = '60%'; }, 3000);
    setTimeout(() => { progressFill.style.width = '85%'; }, 8000);

    return interval;
}

function flightsToPlainText(flights) {
    if (!flights) return 'N/A';
    if (typeof flights === 'string') return flights;
    return JSON.stringify(flights, null, 2);
}

function hotelsToPlainText(hotels) {
    if (!hotels) return 'N/A';
    if (typeof hotels === 'string') return hotels;
    if (Array.isArray(hotels)) return hotels.join('\n\n');
    return JSON.stringify(hotels, null, 2);
}

// ============================================
// ERROR HANDLING
// ============================================
function showError(message) {
    errorSection.classList.remove('hidden');
    inputSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    document.getElementById('errorMessage').textContent = message;
}

// ============================================
// USER INTERACTIONS
// ============================================
function toggleCard(button) {
    const card = button.closest('.card');
    const content = card.querySelector('.card-content');

    content.classList.toggle('collapsed');
    button.textContent = content.classList.contains('collapsed') ? '+' : '−';
}

function resetForm() {
    userInput.value = '';
    currentThreadId = null;
    lastResultData = null;
    flightsPanelVisible = false;
    inputSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    document.getElementById('flightsPanel')?.classList.add('hidden');
    progressFill.style.width = '0%';
    userInput.focus();
}

function downloadItinerary() {
    if (!lastResultData) return;

    const summary = lastResultData.answer || lastResultData.itinerary || '';
    const hotels = hotelsToPlainText(lastResultData.hotel_results);
    const flights = flightsToPlainText(lastResultData.flight_results);

    const content = `
GUZOAI TRAVEL ITINERARY
Generated by Mirt AI
Generated: ${new Date().toLocaleString()}

USER QUERY
${userInput.value}

TRAVEL PLAN
${summary}

HOTEL PICKS
${hotels}

LIVE FLIGHTS (raw data)
${flights}

---
Generated by GuzoAI - Your Personal AI Travel Companion
Powered by Mirt AI
    `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GuzoAI_Itinerary_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!inputSection.classList.contains('hidden')) {
            planForm.dispatchEvent(new Event('submit'));
        }
    }
});
