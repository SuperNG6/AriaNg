(function () {
    'use strict';

    //copy from AdminLTE app.js
    var getHeaderHeight = function () {
        var header = $('.main-header');
        var headerHeight = header.outerHeight() || 0;
        var headerElement = header[0];
        var toolbar = document.querySelector('.main-header .navbar-toolbar > .navbar-nav');

        // AdminLTE gives the mobile header a fixed base height. A wrapped toolbar
        // can visibly extend below it without increasing outerHeight().
        if (headerElement && toolbar) {
            var headerTop = headerElement.getBoundingClientRect().top;
            var toolbarBottom = toolbar.getBoundingClientRect().bottom;
            headerHeight = Math.max(headerHeight, Math.ceil(toolbarBottom - headerTop));
        }

        return headerHeight;
    };

    var fixContentWrapperHeight = function () {
        var windowHeight = $(window).height();
        var headerHeight = getHeaderHeight();
        var footerHeight = $('.main-footer').outerHeight() || 0;
        var neg = headerHeight + footerHeight;

        $('.content-body').css('height', windowHeight - neg);
        $('.fixed .content-wrapper, .fixed .right-side').css('padding-top', headerHeight);
    };

    $(window).on('resize', fixContentWrapperHeight);

    var header = document.querySelector('.main-header');
    var footer = document.querySelector('.main-footer');
    var toolbar = document.querySelector('.main-header .navbar-toolbar > .navbar-nav');

    if (window.ResizeObserver) {
        var resizeObserver = new ResizeObserver(fixContentWrapperHeight);
        if (header) {
            resizeObserver.observe(header);
        }
        if (footer) {
            resizeObserver.observe(footer);
        }
        if (toolbar) {
            resizeObserver.observe(toolbar);
        }
    } else if (window.MutationObserver && header) {
        var mutationObserver = new MutationObserver(fixContentWrapperHeight);
        mutationObserver.observe(header, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    fixContentWrapperHeight();
}());
