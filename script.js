document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('streaming-form');
    const input = document.getElementById('data-input');
    const streamContainer = document.getElementById('stream-container');

    // Replace this URL with your actual API Gateway endpoint
    // const apiUrl = 'https://i7wa804np9.execute-api.us-east-1.amazonaws.com/prod/logdata';

    // Animate sections on scroll
    const animatedSections = document.querySelectorAll('.animated-section');
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    animatedSections.forEach(section => {
        observer.observe(section);
    });

    // Form submission and data streaming
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const data = input.value.trim();
        if (data) {
            sendDataToApi(data);
            input.value = '';
            animateButton();
        }
    });

    async function sendDataToApi(data) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ data: data }),
            });

            // Check if the response is OK (status code 200-299)
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // If the response is JSON, parse it; otherwise, get the text
            const result = await response.text();

            console.log('Success:', result);
            addToStream(`Data stored successfully: ${data}`);
        } catch (error) {
            console.error('Error:', error);
            addToStream(`Error sending data: ${data}`);
        }
    }

    function addToStream(data) {
        const item = document.createElement('div');
        item.textContent = `${new Date().toLocaleTimeString()}: ${data}`;
        item.style.opacity = '0';
        item.style.transform = 'translateX(-20px)';
        streamContainer.prepend(item);

        // Animate the new item
        setTimeout(() => {
            item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            item.style.opacity = '1';
            item.style.transform = 'translateX(0)';
        }, 10);

        // Keep only the last 10 items
        while (streamContainer.children.length > 10) {
            streamContainer.removeChild(streamContainer.lastChild);
        }
    }

    function animateButton() {
        const button = form.querySelector('button');
        button.classList.add('animate');
        setTimeout(() => {
            button.classList.remove('animate');
        }, 500);
    }
});
