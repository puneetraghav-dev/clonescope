#include <stdio.h>

/* Lab 2 - array statistics */

int sum(int a[], int n) {
    int s = 0;
    for (int i = 0; i < n; i++)
        s += a[i];
    return s;
}

int maximum(int a[], int n) {
    int m = a[0];
    for (int i = 1; i < n; i++)
        if (a[i] > m) m = a[i];
    return m;
}

int minimum(int a[], int n) {
    int m = a[0];
    for (int i = 1; i < n; i++)
        if (a[i] < m) m = a[i];
    return m;
}

int secondLargest(int a[], int n, int *found) {
    int max = maximum(a, n), second = 0;
    *found = 0;
    for (int i = 0; i < n; i++) {
        if (a[i] != max && (!*found || a[i] > second)) {
            second = a[i];
            *found = 1;
        }
    }
    return second;
}

int isPalindrome(int a[], int n) {
    for (int i = 0; i < n / 2; i++)
        if (a[i] != a[n - 1 - i]) return 0;
    return 1;
}

int main() {
    int n, a[100], even = 0, odd = 0, found;
    scanf("%d", &n);
    for (int i = 0; i < n; i++) {
        scanf("%d", &a[i]);
        if (a[i] % 2 == 0) even++;
        else odd++;
    }
    int s = sum(a, n);
    printf("Sum: %d\n", s);
    printf("Average: %.2f\n", (float)s / n);
    printf("Max: %d\n", maximum(a, n));
    printf("Min: %d\n", minimum(a, n));
    int sec = secondLargest(a, n, &found);
    if (found) printf("Second largest: %d\n", sec);
    else printf("Second largest: none\n");
    printf("Even: %d Odd: %d\n", even, odd);
    printf("Reversed:");
    for (int i = n - 1; i >= 0; i--) printf(" %d", a[i]);
    printf("\n");
    printf("Palindrome: %s\n", isPalindrome(a, n) ? "Yes" : "No");
    return 0;
}
