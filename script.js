// variable scroll is updated on updated everytime "scroll"
// event is triggered

// var scroll = 0;
// var tmp_scroll;
// tmp_scroll = scroll;
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

//on load of page

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