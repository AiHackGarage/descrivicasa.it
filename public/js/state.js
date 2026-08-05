// ── Global application state ─────────────────────────────────

// Auth
window.authToken = localStorage.getItem('dc_token');
window.currentUser = null;
window.currentView = 'landing';

// Editor wizard state
window.editorState = {
    editingId: null,
    step: 1,
    totalSteps: 5,
    data: {
        contract: 'vendita',
        type: 'Appartamento',
        price: '',
        condominium: '',
        address: '',
        city: '',
        province: '',
        lat: 41.9028,
        lng: 12.4964,
        surface: '',
        rooms: '',
        bedrooms: '',
        bathrooms: '',
        floor: '',
        total_floors: '',
        elevator: false,
        condition: 'Nuovo',
        energy_class: 'A4',
        heating: 'Autonomo',
        air_conditioning: false,
        exposure: '',
        balcony: '',
        garden: '',
        parking: false,
        basement: false,
        furnished: 'No',
        year_built: '',
        photos: [],
        description: '',
        phone: '',
        email: ''
    }
};
window.editorMap = null;
window.editorMarker = null;

// Single-page edit state
window.editState = {
    id: null,
    uuid: null,
    data: {},
    originalType: null
};
window.editMap = null;
window.editMarker = null;

// Dashboard cache
window._dashboardProperties = [];

// Chat
window.chatHistory = JSON.parse(localStorage.getItem('dc_chat') || '[]');

// Banner timer
window.bannerTimer = null;

// Detail view cache
window._detailProperty = null;
window._detailViewUuid = null;
