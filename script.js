// variable scroll is updated on updated everytime "scroll"
// event is triggered

// var scroll = 0;
// var tmp_scroll;
// tmp_scroll = scroll;
// Mobile menu toggle and hide-on-scroll
let lastScroll = 0;
const THRESHOLD = 5;

document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');

    if (!header || !toggle || !mobileMenu) return;

    toggle.addEventListener('click', (e) => {
        const isOpen = header.classList.toggle('menu-open');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        mobileMenu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        // fallback: force inline display in case CSS selector specificity prevents showing
        mobileMenu.style.display = isOpen ? 'flex' : 'none';
    });

    // Close menu when a mobile link is clicked
    mobileMenu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            header.classList.remove('menu-open');
            toggle.setAttribute('aria-expanded', 'false');
                mobileMenu.setAttribute('aria-hidden', 'true');
                mobileMenu.style.display = 'none';
        });
    });

    // Hide mobile menu on scroll
    window.addEventListener('scroll', () => {
        const scrollPos = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
        if (Math.abs(scrollPos - lastScroll) > THRESHOLD) {
            if (header.classList.contains('menu-open')) {
                header.classList.remove('menu-open');
                toggle.setAttribute('aria-expanded', 'false');
                mobileMenu.setAttribute('aria-hidden', 'true');
                mobileMenu.style.display = 'none';
            }
            lastScroll = scrollPos;
        }
    }, { passive: true });
});

window.addEventListener("scroll", (event) => {
    scroll = this.scrollY;
    // console.log(scroll);
    // if (scroll > tmp_scroll+10 || scroll < tmp_scroll-10) {
    //     //get a random color between rgb(100, 100, 100) and rgb(200, 200, 200)
    //     var a = Math.floor(Math.random() * 100) + 20;
    //     var color = "rgb(" + a + "," + a + "," + a + ")";
    //     tmp_scroll = scroll;
    //     document.querySelector("nav h1").style.backgroundColor = color;
    // }
});

window.onload = function() {
    var out= document.querySelectorAll('.out'); 
    for(let i = 0; i < out.length; i++) {
        out[i].onclick =  function(event) {    
            if(event.target.parentNode.querySelector(".text_ref").classList[1] !== "show") {
                event.target.parentNode.querySelector(".text_ref").classList.toggle("show");
                event.target.parentNode.querySelector(".arrow-down").style.transform = "rotate(135deg)";
            }
            else {
                event.target.parentNode.querySelector(".text_ref").classList.toggle("show");
                event.target.parentNode.querySelector(".arrow-down").style.transform = "rotate(-45deg)";
            }
            console.log(event.target.parentNode.querySelector(".text_ref").style);
        }
    }
}