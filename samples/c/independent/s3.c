#include <stdio.h>
#include <stdlib.h>

void readArray(int *p, int n) {
    for (int *q = p; q < p + n; q++) scanf("%d", q);
}

long total(const int *p, int n) {
    long t = 0;
    const int *end = p + n;
    while (p < end) t += *p++;
    return t;
}

void extremes(const int *p, int n, int *hi, int *lo) {
    *hi = *lo = *p;
    for (const int *q = p + 1; q < p + n; q++) {
        if (*q > *hi) *hi = *q;
        if (*q < *lo) *lo = *q;
    }
}

int main() {
    int n;
    scanf("%d", &n);
    int *data = (int *)malloc(n * sizeof(int));
    if (data == NULL) return 1;
    readArray(data, n);
    int hi, lo;
    extremes(data, n, &hi, &lo);
    long t = total(data, n);
    printf("Sum: %ld\n", t);
    printf("Average: %.2f\n", (double)t / n);
    printf("Max: %d\nMin: %d\n", hi, lo);
    int *second = NULL;
    for (int *q = data; q < data + n; q++)
        if (*q != hi && (second == NULL || *q > *second)) second = q;
    if (second) printf("Second largest: %d\n", *second);
    else puts("Second largest: none");
    int evens = 0;
    for (int *q = data; q < data + n; q++) evens += (*q % 2 == 0);
    printf("Even: %d Odd: %d\n", evens, n - evens);
    printf("Reversed:");
    for (int *q = data + n - 1; q >= data; q--) printf(" %d", *q);
    putchar('\n');
    int *l = data, *r = data + n - 1, pal = 1;
    while (l < r) if (*l++ != *r--) { pal = 0; break; }
    printf("Palindrome: %s\n", pal ? "Yes" : "No");
    free(data);
    return 0;
}
