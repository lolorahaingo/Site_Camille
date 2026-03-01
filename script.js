// script.js — Camille Larode — Site Vitrine

document.addEventListener('DOMContentLoaded', () => {

    // ── Mobile menu toggle ──
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');

    if (header && toggle && mobileMenu) {
        toggle.addEventListener('click', () => {
            const isOpen = header.classList.toggle('menu-open');
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            mobileMenu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
            mobileMenu.style.display = isOpen ? 'flex' : 'none';
        });

        // Close menu on link click
        mobileMenu.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                header.classList.remove('menu-open');
                toggle.setAttribute('aria-expanded', 'false');
                mobileMenu.setAttribute('aria-hidden', 'true');
                mobileMenu.style.display = 'none';
            });
        });

        // Close menu on scroll
        let lastScroll = 0;
        window.addEventListener('scroll', () => {
            const scrollPos = window.scrollY;
            if (Math.abs(scrollPos - lastScroll) > 5) {
                if (header.classList.contains('menu-open')) {
                    header.classList.remove('menu-open');
                    toggle.setAttribute('aria-expanded', 'false');
                    mobileMenu.setAttribute('aria-hidden', 'true');
                    mobileMenu.style.display = 'none';
                }
                lastScroll = scrollPos;
            }
        }, { passive: true });
    }

    // ── Header shadow on scroll ──
    if (header) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 10) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        }, { passive: true });
    }

    // ── Scroll reveal animation ──
    const revealElements = document.querySelectorAll('.reveal');

    if (revealElements.length > 0 && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.15,
            rootMargin: '0px 0px -40px 0px'
        });

        revealElements.forEach(el => observer.observe(el));
    }

    // ── Smooth scroll for anchor links ──
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const targetId = anchor.getAttribute('href');
            if (targetId === '#') return;
            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                const headerHeight = header ? header.offsetHeight : 0;
                const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

});
